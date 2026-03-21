import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { registerJiraTools } from "./tools/jira";
import { registerConfluenceTools } from "./tools/confluence";

import type { Request, Response } from "express";

async function main(): Promise<void> {
  // Load and validate config
  const config = loadConfig();
  logger.info(`Starting MCP server on port ${config.port}`);
  logger.info(`Jira URL: ${config.jiraBaseUrl}`);
  logger.info(`Confluence URL: ${config.confluenceBaseUrl}`);

  // Factory to create a fresh MCP server per session
  const createServer = (): McpServer => {
    const server = new McpServer(
      {
        name: "jira-confluence-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    registerJiraTools(server, config);
    registerConfluenceTools(server, config);
    return server;
  };

  // Create Express app with DNS rebinding protection disabled (Docker use case)
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "jira-confluence-mcp",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  });

  // Store transports by session ID
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // MCP POST endpoint
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        const eventStore = new InMemoryEventStore();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
            logger.info(`New MCP session: ${newSessionId}`);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
            logger.info(`Session closed: ${sid}`);
          }
        };

        // Create and connect a new MCP server for this session
        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
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

  // SSE streams for resumability
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Start server
  app.listen(config.port, () => {
    logger.info(`MCP server listening on http://0.0.0.0:${config.port}`);
    logger.info("Tools: getMyTickets, searchJira, getIssueDetails, searchPages, getPage");
    logger.info("Health: GET /health | MCP: POST /mcp");
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
        delete transports[sid];
      } catch {
        // ignore cleanup errors
      }
    }
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
