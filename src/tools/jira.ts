import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { JiraClient } from "../clients/jira-client";
import { Config, validateJiraConfig } from "../config";
import { logger } from "../logger";

export function registerJiraTools(server: McpServer, config: Config): void {
  const missingConfig = validateJiraConfig(config);
  const client = missingConfig.length === 0
    ? new JiraClient(config.jiraBaseUrl, config.jiraPat)
    : null;

  const configError = () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error: `Jira not configured. Missing: ${missingConfig.join(", ")}. Set these as environment variables.` }) }],
    isError: true,
  });

  // Tool 1: getMyTickets
  server.registerTool("getMyTickets", {
    description: "Fetch Jira issues assigned to the current user updated within the last N days. Use this when the user asks about their recent tickets, workload, or assigned issues.",
    inputSchema: {
      lastNDays: z.number().int().min(1).describe("Number of days to look back for updated issues"),
    },
  }, async ({ lastNDays }) => {
    if (!client) return configError();
    try {
      logger.info(`getMyTickets called with lastNDays=${lastNDays}`);
      const jql = `assignee = currentUser() AND updated >= -${lastNDays}d ORDER BY updated DESC`;
      const tickets = await client.searchIssues(jql);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ tickets, total: tickets.length }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`getMyTickets failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 2: searchJira
  server.registerTool("searchJira", {
    description: "Search Jira issues using a JQL (Jira Query Language) query. Use this for custom searches like finding issues by project, status, label, sprint, or any JQL expression.",
    inputSchema: {
      jql: z.string().min(1).describe("JQL query string to search for issues"),
    },
  }, async ({ jql }) => {
    if (!client) return configError();
    try {
      logger.info("searchJira called");
      const tickets = await client.searchIssues(jql);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ tickets, total: tickets.length }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`searchJira failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 3: getIssueDetails
  server.registerTool("getIssueDetails", {
    description: "Get detailed information about a specific Jira issue by its key (e.g., PROJ-123). Returns summary, status, description, assignee, reporter, and dates.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Jira issue key, e.g., PROJ-123"),
    },
  }, async ({ issueKey }) => {
    if (!client) return configError();
    try {
      logger.info(`getIssueDetails called for ${issueKey}`);
      const issue = await client.getIssue(issueKey);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ issue }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`getIssueDetails failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  logger.info("Jira tools registered: getMyTickets, searchJira, getIssueDetails");
}
