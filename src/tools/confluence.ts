import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { ConfluenceClient } from "../clients/confluence-client";
import { Config, validateConfluenceConfig } from "../config";
import { logger } from "../logger";

export function registerConfluenceTools(server: McpServer, config: Config): void {
  const missingConfig = validateConfluenceConfig(config);
  const client = missingConfig.length === 0
    ? new ConfluenceClient(config.confluenceBaseUrl, config.confluencePat)
    : null;

  const configError = () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error: `Confluence not configured. Missing: ${missingConfig.join(", ")}. Set these as environment variables.` }) }],
    isError: true,
  });

  // Tool 1: searchPages
  server.registerTool("searchPages", {
    description: "Search Confluence pages by keyword. Returns matching page titles, spaces, and URLs. Use this when the user wants to find documentation or wiki pages.",
    inputSchema: {
      query: z.string().min(1).describe("Search keywords to find Confluence pages"),
    },
  }, async ({ query }) => {
    if (!client) return configError();
    try {
      logger.info("searchPages called");
      const pages = await client.searchPages(query);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ pages, total: pages.length }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`searchPages failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 2: getPage
  server.registerTool("getPage", {
    description: "Get the full content of a specific Confluence page by its ID. Returns the page title, body content, space, and version info.",
    inputSchema: {
      pageId: z.string().min(1).describe("Confluence page ID"),
    },
  }, async ({ pageId }) => {
    if (!client) return configError();
    try {
      logger.info(`getPage called for ${pageId}`);
      const page = await client.getPage(pageId);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ page }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`getPage failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 3: listSpaces
  server.registerTool("listSpaces", {
    description: "List all Confluence spaces accessible to the authenticated user. Useful for finding space keys to use in other commands or browsing available documentation areas.",
    inputSchema: {},
  }, async () => {
    if (!client) return configError();
    try {
      logger.info("listSpaces called");
      const spaces = await client.listSpaces();

      // Map to a cleaner format focusing on key and name
      const simplifiedSpaces = spaces.map((s: any) => ({
        key: s.key,
        name: s.name,
        type: s.type
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ spaces: simplifiedSpaces, total: simplifiedSpaces.length }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`listSpaces failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 4: createPage
  server.registerTool("createPage", {
    description: "Create a new Confluence page in a specific space. Use this when the user asks to create a document, wiki page, or new content. Content should be in HTML format.",
    inputSchema: {
      spaceKey: z.string().min(1).describe("The key of the Confluence space, e.g., 'DOCS'"),
      title: z.string().min(1).describe("The title of the new page"),
      content: z.string().min(1).describe("The HTML/XHTML content of the page"),
    },
  }, async ({ spaceKey, title, content }) => {
    if (!client) return configError();
    try {
      logger.info(`createPage called for space ${spaceKey} with title "${title}"`);
      const pageId = await client.createPage(spaceKey, title, content);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, pageId, message: `Page "${title}" created successfully in space ${spaceKey}.` }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`createPage failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  logger.info("Confluence tools registered: searchPages, getPage, listSpaces, createPage");
}
