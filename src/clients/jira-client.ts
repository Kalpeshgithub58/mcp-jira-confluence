import axios, { AxiosInstance, AxiosError } from "axios";
import { logger } from "../logger";

interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssueRaw[];
}

interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string };
    updated: string;
    description?: string;
    issuetype?: { name: string };
    project?: { key: string; name: string };
    created?: string;
    reporter?: { displayName: string };
  };
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string;
  updated: string;
  type: string;
  project: string;
}

export interface JiraIssueDetail extends JiraIssue {
  description: string;
  created: string;
  reporter: string;
}

function mapIssue(raw: JiraIssueRaw): JiraIssue {
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status?.name ?? "Unknown",
    priority: raw.fields.priority?.name ?? "None",
    assignee: raw.fields.assignee?.displayName ?? "Unassigned",
    updated: raw.fields.updated?.split("T")[0] ?? "",
    type: raw.fields.issuetype?.name ?? "Unknown",
    project: raw.fields.project?.key ?? "",
  };
}

function mapIssueDetail(raw: JiraIssueRaw): JiraIssueDetail {
  return {
    ...mapIssue(raw),
    description: raw.fields.description ?? "",
    created: raw.fields.created?.split("T")[0] ?? "",
    reporter: raw.fields.reporter?.displayName ?? "Unknown",
  };
}

export class JiraClient {
  private client: AxiosInstance;
  private maxRetries = 3;

  constructor(baseUrl: string, pat: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });
  }

  async searchIssues(jql: string): Promise<JiraIssue[]> {
    logger.info("Jira search", { jql });
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {
      const response = await this.requestWithRetry<JiraSearchResponse>(
        "GET",
        "/rest/api/2/search",
        { jql, startAt, maxResults, fields: "summary,status,priority,assignee,updated,issuetype,project" }
      );

      allIssues.push(...response.issues.map(mapIssue));
      logger.info(`Fetched ${allIssues.length}/${response.total} issues`);

      if (startAt + response.maxResults >= response.total) {
        break;
      }
      startAt += response.maxResults;
    }

    return allIssues;
  }

  async getIssue(issueKey: string): Promise<JiraIssueDetail> {
    logger.info("Jira get issue", { issueKey });
    const response = await this.requestWithRetry<JiraIssueRaw>(
      "GET",
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
      { fields: "summary,status,priority,assignee,updated,description,issuetype,project,created,reporter" }
    );
    return mapIssueDetail(response);
  }

  async createIssue(projectKey: string, summary: string, description: string, issueType: string, extraFields?: Record<string, any>): Promise<{ key: string }> {
    logger.info("Jira create issue", { projectKey, summary });
    return this.requestWithRetry<{ key: string }>("POST", "/rest/api/2/issue", {
      fields: {
        project: { key: projectKey },
        summary,
        description,
        issuetype: { name: issueType },
        ...(extraFields ?? {})
      }
    });
  }

  async addComment(issueKey: string, body: string): Promise<void> {
    logger.info("Jira add comment", { issueKey });
    await this.requestWithRetry("POST", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
      body
    });
  }

  async updateIssue(issueKey: string, transitionId: string): Promise<void> {
    logger.info("Jira transition issue", { issueKey, transitionId });
    await this.requestWithRetry("POST", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transitionId }
    });
  }

  async listProjects(): Promise<any[]> {
    logger.info("Jira list projects");
    return this.requestWithRetry<any[]>("GET", "/rest/api/2/project");
  }

  async editIssue(
    issueKey: string,
    fields: {
      summary?: string;
      description?: string;
      assignee?: string;
      priority?: string;
    }
  ): Promise<void> {
    logger.info("Jira edit issue", { issueKey, fields: Object.keys(fields) });

    // Build the fields object for PUT /rest/api/2/issue/{key}
    // Only include fields that were actually provided
    const body: Record<string, any> = { fields: {} };
    if (fields.summary !== undefined) body.fields.summary = fields.summary;
    if (fields.description !== undefined) body.fields.description = fields.description;
    if (fields.assignee !== undefined) body.fields.assignee = { name: fields.assignee };
    if (fields.priority !== undefined) body.fields.priority = { name: fields.priority };

    await this.requestWithRetry<void>("PUT", `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, body);
  }

  async getComments(issueKey: string): Promise<any[]> {
    logger.info("Jira get comments", { issueKey });
    const response = await this.requestWithRetry<any>("GET", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`);
    return response.comments || [];
  }

  async getTransitions(issueKey: string): Promise<any[]> {
    logger.info("Jira get transitions", { issueKey });
    const response = await this.requestWithRetry<any>("GET", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`);
    return response.transitions || [];
  }

  async getIssueHistory(issueKey: string): Promise<any[]> {
    logger.info("Jira get issue history", { issueKey });
    const response = await this.requestWithRetry<any>("GET", `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { expand: "changelog" });
    return response.changelog?.histories || [];
  }

  async getSubtasks(issueKey: string): Promise<JiraIssue[]> {
    logger.info("Jira get subtasks", { issueKey });
    const jql = `parent = "${issueKey}" OR "Epic Link" = "${issueKey}"`;
    return this.searchIssues(jql);
  }

  async getLinkTypes(): Promise<any[]> {
    logger.info("Jira get link types");
    const response = await this.requestWithRetry<any>("GET", "/rest/api/2/issueLinkType");
    return response.issueLinkTypes || [];
  }

  async linkIssues(inwardIssue: string, outwardIssue: string, linkType: string): Promise<void> {
    logger.info("Jira link issues", { inwardIssue, outwardIssue, linkType });
    await this.requestWithRetry("POST", "/rest/api/2/issueLink", {
      type: { name: linkType },
      inwardIssue: { key: inwardIssue },
      outwardIssue: { key: outwardIssue }
    });
  }

  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    logger.info("Jira delete comment", { issueKey, commentId });
    await this.requestWithRetry("DELETE", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`);
  }

  async getIssueAttachments(issueKey: string): Promise<any[]> {
    logger.info("Jira get attachments", { issueKey });
    const response = await this.requestWithRetry<any>("GET", `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields: "attachment" });
    return response.fields?.attachment || [];
  }

  async listBoards(): Promise<any[]> {
    logger.info("Jira list Agile boards");
    const response = await this.requestWithRetry<any>("GET", "/rest/agile/1.0/board");
    return response.values || [];
  }

  async getSprints(boardId: number): Promise<any[]> {
    logger.info("Jira get sprints", { boardId });
    const response = await this.requestWithRetry<any>("GET", `/rest/agile/1.0/board/${boardId}/sprint`);
    return response.values || [];
  }

  async searchUsers(query: string): Promise<any[]> {
    logger.info("Jira search users", { query });
    // In Jira Server/DC, the param is usually 'username'. In Cloud, it's 'query'.
    // Passing both covers both environments gracefully.
    return this.requestWithRetry<any[]>("GET", "/rest/api/2/user/search", { username: query, query });
  }

  async addWorklog(issueKey: string, timeSpent: string, comment?: string): Promise<void> {
    logger.info("Jira add worklog", { issueKey, timeSpent });
    await this.requestWithRetry("POST", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`, {
      timeSpent,
      ...(comment ? { comment } : {})
    });
  }

  async deleteIssue(issueKey: string): Promise<void> {
    logger.info("Jira delete issue", { issueKey });
    await this.requestWithRetry("DELETE", `/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
  }

  async getFilters(): Promise<any[]> {
    logger.info("Jira get favourite filters");
    // Retrieve the user's favourite (starred) filters
    const response = await this.requestWithRetry<any[]>("GET", "/rest/api/2/filter/favourite");
    return response || [];
  }

  async getCreateMeta(projectKey: string, issueTypeName?: string): Promise<any> {
    logger.info("Jira get create meta", { projectKey, issueTypeName });
    const params: Record<string, any> = {
      projectKeys: projectKey,
      expand: "projects.issuetypes.fields"
    };
    if (issueTypeName) params.issuetypeNames = issueTypeName;
    return this.requestWithRetry<any>("GET", "/rest/api/2/issue/createmeta", params);
  }

  private async requestWithRetry<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, dataOrParams?: any): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const config = {
          method,
          url: path,
          ...(method === "GET" ? { params: dataOrParams } : { data: dataOrParams }),
        };
        const response = await this.client.request<T>(config);
        // PUT returns 204 No Content — response.data is undefined/empty, which is correct
        return response.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        if (status === 401) {
          throw new Error("Jira authentication failed: invalid or expired token");
        }
        if (status === 403) {
          throw new Error("Jira access denied: insufficient permissions");
        }
        if (status === 429 && attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn(`Jira rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          lastError = axiosErr;
          continue;
        }
        if (axiosErr.code === "ECONNREFUSED" || axiosErr.code === "ENOTFOUND" || axiosErr.code === "ETIMEDOUT") {
          throw new Error(`Jira connection failed: ${axiosErr.code}`);
        }

        // Try to parse detailed Jira error body (e.g. { errorMessages: [...], errors: { field: "msg" } })
        let detailedMessage = axiosErr.message;
        const responseData = axiosErr.response?.data as any;
        if (responseData && typeof responseData === 'object') {
          const msgs: string[] = [];
          if (Array.isArray(responseData.errorMessages) && responseData.errorMessages.length > 0) {
            msgs.push(...responseData.errorMessages);
          }
          if (responseData.errors && typeof responseData.errors === 'object') {
            for (const [field, err] of Object.entries(responseData.errors)) {
              msgs.push(`Field '${field}': ${err}`);
            }
          }
          if (msgs.length > 0) {
            detailedMessage = msgs.join(" | ");
          }
        }

        throw new Error(`Jira API error: ${status ?? "unknown"} - ${detailedMessage}`);
      }
    }

    throw lastError ?? new Error("Jira request failed after retries");
  }
}
