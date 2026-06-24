#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { registerJiraTools } from "./tools/jira";
import { registerConfluenceTools } from "./tools/confluence";

import type { Request, Response } from "express";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// ---------- Legacy SSE session ----------
interface SseSession {
  res: Response;
  server: McpServer;
  sendMessage: (msg: JSONRPCMessage) => void;
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(`Starting MCP server on port ${config.port}`);

  // Factory to create a fresh MCP server per session
  const createServer = (): McpServer => {
    const server = new McpServer(
      { name: "jira-confluence-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    registerJiraTools(server, config);
    registerConfluenceTools(server, config);
    return server;
  };

  // Create Express app
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // ===========================
  //  Health endpoint
  // ===========================
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "jira-confluence-mcp",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  });

  // ===========================
  //  Streamable HTTP transport (modern clients)
  //  POST /mcp, GET /mcp, DELETE /mcp
  // ===========================
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const eventStore = new InMemoryEventStore();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
            logger.info(`New Streamable HTTP session: ${newSessionId}`);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
            logger.info(`Streamable HTTP session closed: ${sid}`);
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`MCP request error: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // ===========================
  //  Legacy SSE transport (Windsurf, older clients)
  //  GET /sse  -> SSE stream
  //  POST /messages?sessionId=xxx -> JSON-RPC messages
  // ===========================
  const sseSessions: Record<string, SseSession> = {};

  app.get("/sse", (req: Request, res: Response) => {
    const sessionId = randomUUID();
    logger.info(`New SSE session: ${sessionId}`);

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Helper to send SSE events
    const sendEvent = (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    // Helper to send JSON-RPC messages back to the client
    const sendMessage = (msg: JSONRPCMessage) => {
      sendEvent("message", JSON.stringify(msg));
    };

    // Create MCP server for this session
    const server = createServer();

    sseSessions[sessionId] = { res, server, sendMessage };

    // Hook into the server's transport to intercept outgoing messages
    // We use a custom transport-like approach via the server's send method
    const originalClose = server.close.bind(server);

    // Send the endpoint event so the client knows where to POST
    const messagesUrl = `/messages?sessionId=${sessionId}`;
    sendEvent("endpoint", messagesUrl);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 30000);

    // Clean up on disconnect
    req.on("close", () => {
      clearInterval(keepAlive);
      delete sseSessions[sessionId];
      originalClose();
      logger.info(`SSE session closed: ${sessionId}`);
    });
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId || !sseSessions[sessionId]) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session ID" },
        id: null,
      });
      return;
    }

    const session = sseSessions[sessionId];

    try {
      const message = req.body as JSONRPCMessage;

      // If this is an initialize request, wire up the server with our SSE transport adapter
      if (isInitializeRequest(message)) {
        const sseTransport = new SseTransportAdapter(session.sendMessage);
        await session.server.connect(sseTransport);
        await sseTransport.handleMessage(message);
        (session as any).transport = sseTransport;
        res.status(202).json({ status: "accepted" });
        return;
      }

      // For subsequent messages, use the stored transport
      const transport = (session as any).transport as SseTransportAdapter | undefined;
      if (!transport) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session not initialized" },
          id: null,
        });
        return;
      }

      await transport.handleMessage(message);
      res.status(202).json({ status: "accepted" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error(`SSE message error: ${msg}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // ===========================
  //  Start server
  // ===========================
  const args = process.argv.slice(2);
  if (args.includes("stdio") || args.includes("--stdio")) {
    logger.info("Starting MCP server in STDIO mode");
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("MCP server running over STDIO");
  } else {
    app.listen(config.port, () => {
      logger.info(`MCP server listening on http://0.0.0.0:${config.port}`);
      logger.info("Tools: getMyTickets, searchJira, getIssueDetails, createIssue, addComment, updateIssue, listProjects, editIssue, searchPages, getPage, listSpaces, createPage, editPage");
      logger.info("Streamable HTTP: POST /mcp | Legacy SSE: GET /sse + POST /messages");
      logger.info("Health: GET /health");
    });
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    for (const sid of Object.keys(transports)) {
      try { await transports[sid].close(); } catch { /* ignore */ }
      delete transports[sid];
    }
    for (const sid of Object.keys(sseSessions)) {
      try { sseSessions[sid].res.end(); } catch { /* ignore */ }
      delete sseSessions[sid];
    }
    process.exit(0);
  });
}

// ===========================
//  Minimal SSE Transport Adapter
//  Bridges the MCP server to SSE by implementing the Transport interface
// ===========================
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

class SseTransportAdapter implements Transport {
  private _sendToClient: (msg: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor(sendToClient: (msg: JSONRPCMessage) => void) {
    this._sendToClient = sendToClient;
  }

  async start(): Promise<void> {
    // No-op for SSE; connection is already established
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this._sendToClient(message);
  }

  // Called when we receive a message from the client via POST /messages
  async handleMessage(message: JSONRPCMessage): Promise<void> {
    this.onmessage?.(message);
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
