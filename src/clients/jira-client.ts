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
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
      { fields: "summary,status,priority,assignee,updated,description,issuetype,project,created,reporter" }
    );
    return mapIssueDetail(response);
  }

  private async requestWithRetry<T>(path: string, params: Record<string, unknown>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get<T>(path, { params });
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

        throw new Error(`Jira API error: ${status ?? "unknown"} - ${axiosErr.message}`);
      }
    }

    throw lastError ?? new Error("Jira request failed after retries");
  }
}
