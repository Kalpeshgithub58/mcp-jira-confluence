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

  // Tool 4: createIssue
  server.registerTool("createIssue", {
    description: "Create a new Jira issue (epic, story, task, bug, etc.) in a specific project. Use this when the user asks to create a bug, task, or ticket.",
    inputSchema: {
      projectKey: z.string().min(1).describe("The key of the Jira project, e.g., PROJ"),
      summary: z.string().min(1).describe("The title or summary of the issue"),
      description: z.string().describe("Detailed description of the issue"),
      issueType: z.string().min(1).describe("The issue type name, e.g., 'Bug', 'Task', 'Story'"),
    },
  }, async ({ projectKey, summary, description, issueType }) => {
    if (!client) return configError();
    try {
      logger.info(`createIssue called for project ${projectKey}`);
      const result = await client.createIssue(projectKey, summary, description, issueType);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, issueKey: result.key, message: `Issue ${result.key} created successfully.` }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`createIssue failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 5: addComment
  server.registerTool("addComment", {
    description: "Add a comment to an existing Jira issue. Use this when the user asks to reply to, update, or comment on a ticket.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Jira issue key, e.g., PROJ-123"),
      body: z.string().min(1).describe("The text content of the comment"),
    },
  }, async ({ issueKey, body }) => {
    if (!client) return configError();
    try {
      logger.info(`addComment called for ${issueKey}`);
      await client.addComment(issueKey, body);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, message: `Comment added successfully to ${issueKey}.` }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`addComment failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 6: updateIssue (transitions)
  server.registerTool("updateIssue", {
    description: "Transition a Jira issue to a new status (e.g., move from 'Open' to 'In Progress' or 'Done'). Requires the transition ID.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Jira issue key, e.g., PROJ-123"),
      transitionId: z.string().min(1).describe("The numeric ID of the transition (you may need to look this up via Jira API separately or assume standard IDs if known)"),
    },
  }, async ({ issueKey, transitionId }) => {
    if (!client) return configError();
    try {
      logger.info(`updateIssue called for ${issueKey} with transition ${transitionId}`);
      await client.updateIssue(issueKey, transitionId);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, message: `Issue ${issueKey} transitioned successfully.` }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`updateIssue failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 7: listProjects
  server.registerTool("listProjects", {
    description: "List all Jira projects accessible to the authenticated user. Useful for finding project keys to use in other commands.",
    inputSchema: {},
  }, async () => {
    if (!client) return configError();
    try {
      logger.info("listProjects called");
      const projects = await client.listProjects();

      // Map to a cleaner format focusing on key and name
      const simplifiedProjects = projects.map((p: any) => ({
        key: p.key,
        name: p.name,
        id: p.id
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ projects: simplifiedProjects, total: simplifiedProjects.length }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`listProjects failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  // Tool 8: editIssue
  server.registerTool("editIssue", {
    description: "Edit an existing Jira issue. You can update any combination of: summary (title), description, assignee (username), or priority. Only the fields you provide will be changed — everything else stays the same.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Jira issue key, e.g., PROJ-123"),
      summary: z.string().optional().describe("New title/summary for the issue"),
      description: z.string().optional().describe("New description for the issue"),
      assignee: z.string().optional().describe("Username of the person to assign the ticket to"),
      priority: z.string().optional().describe("New priority name, e.g., 'High', 'Medium', 'Low', 'Critical'"),
    },
  }, async ({ issueKey, summary, description, assignee, priority }) => {
    if (!client) return configError();
    try {
      logger.info(`editIssue called for ${issueKey}`);

      // Guard: at least one field must be provided
      if (!summary && !description && !assignee && !priority) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No fields to update. Provide at least one of: summary, description, assignee, priority." }) }],
          isError: true,
        };
      }

      await client.editIssue(issueKey, { summary, description, assignee, priority });

      // Fetch and return the updated issue so the AI can confirm the change
      const updated = await client.getIssue(issueKey);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, message: `Issue ${issueKey} updated successfully.`, updatedIssue: updated }, null, 2),
        }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`editIssue failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  logger.info("Jira tools registered: getMyTickets, searchJira, getIssueDetails, createIssue, addComment, updateIssue, listProjects, editIssue");
}
