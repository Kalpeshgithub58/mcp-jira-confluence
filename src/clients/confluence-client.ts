import axios, { AxiosInstance, AxiosError } from "axios";
import { logger } from "../logger";

interface ConfluenceSearchResponse {
  results: ConfluencePageRaw[];
  start: number;
  limit: number;
  size: number;
  _links?: { next?: string };
}

interface ConfluencePageRaw {
  id: string;
  type: string;
  title: string;
  status: string;
  space?: { key: string; name: string };
  body?: { storage?: { value: string } };
  version?: { number: number; when: string };
  _links?: { webui?: string };
}

export interface ConfluencePage {
  id: string;
  title: string;
  space: string;
  spaceName: string;
  status: string;
  url: string;
}

export interface ConfluencePageDetail extends ConfluencePage {
  body: string;
  version: number;
  lastUpdated: string;
}

function mapPage(raw: ConfluencePageRaw, baseUrl: string): ConfluencePage {
  return {
    id: raw.id,
    title: raw.title,
    space: raw.space?.key ?? "",
    spaceName: raw.space?.name ?? "",
    status: raw.status,
    url: raw._links?.webui ? `${baseUrl}${raw._links.webui}` : "",
  };
}

function mapPageDetail(raw: ConfluencePageRaw, baseUrl: string): ConfluencePageDetail {
  return {
    ...mapPage(raw, baseUrl),
    body: raw.body?.storage?.value ?? "",
    version: raw.version?.number ?? 0,
    lastUpdated: raw.version?.when?.split("T")[0] ?? "",
  };
}

export class ConfluenceClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private maxRetries = 3;

  constructor(baseUrl: string, pat: string) {
    this.baseUrl = baseUrl;
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

  async searchPages(query: string): Promise<ConfluencePage[]> {
    logger.info("Confluence search", { query });
    const allPages: ConfluencePage[] = [];
    let start = 0;
    const limit = 25;

    while (true) {
      const response = await this.requestWithRetry<ConfluenceSearchResponse>(
        "/rest/api/content/search",
        { cql: `type=page AND (title~"${query}" OR text~"${query}")`, start, limit, expand: "space" }
      );

      allPages.push(...response.results.map((r) => mapPage(r, this.baseUrl)));
      logger.info(`Fetched ${allPages.length} pages so far`);

      if (!response._links?.next || response.size < limit) {
        break;
      }
      start += limit;
    }

    return allPages;
  }

  async getPage(pageId: string): Promise<ConfluencePageDetail> {
    logger.info("Confluence get page", { pageId });
    const response = await this.requestWithRetry<ConfluencePageRaw>(
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      { expand: "body.storage,version,space" }
    );
    return mapPageDetail(response, this.baseUrl);
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
          throw new Error("Confluence authentication failed: invalid or expired token");
        }
        if (status === 403) {
          throw new Error("Confluence access denied: insufficient permissions");
        }
        if (status === 429 && attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn(`Confluence rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          lastError = axiosErr;
          continue;
        }
        if (axiosErr.code === "ECONNREFUSED" || axiosErr.code === "ENOTFOUND" || axiosErr.code === "ETIMEDOUT") {
          throw new Error(`Confluence connection failed: ${axiosErr.code}`);
        }

        throw new Error(`Confluence API error: ${status ?? "unknown"} - ${axiosErr.message}`);
      }
    }

    throw lastError ?? new Error("Confluence request failed after retries");
  }
}
