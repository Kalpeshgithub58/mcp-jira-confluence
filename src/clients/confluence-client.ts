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
        "GET",
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
      "GET",
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      { expand: "body.storage,version,space" }
    );
    return mapPageDetail(response, this.baseUrl);
  }

  async createPage(spaceKey: string, title: string, content: string): Promise<string> {
    logger.info("Confluence create page", { spaceKey, title });
    const response = await this.requestWithRetry<ConfluencePageRaw>(
      "POST",
      "/rest/api/content",
      {
        type: "page",
        title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: content,
            representation: "storage"
          }
        }
      }
    );
    return response.id;
  }

  async editPage(
    pageId: string,
    fields: { title?: string; content?: string }
  ): Promise<ConfluencePageDetail> {
    logger.info("Confluence edit page", { pageId, fields: Object.keys(fields) });

    // Step 1: GET the current page to obtain the version number and existing content
    const current = await this.requestWithRetry<ConfluencePageRaw>(
      "GET",
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      { expand: "body.storage,version,space" }
    );

    const currentVersion = current.version?.number ?? 0;
    const currentTitle = current.title;
    const currentBody = current.body?.storage?.value ?? "";

    // Step 2: PUT with version + 1, merging only the fields that changed
    const updatedPage = await this.requestWithRetry<ConfluencePageRaw>(
      "PUT",
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      {
        id: pageId,
        type: "page",
        title: fields.title ?? currentTitle,
        body: {
          storage: {
            value: fields.content ?? currentBody,
            representation: "storage",
          },
        },
        version: {
          number: currentVersion + 1,
        },
      }
    );

    return mapPageDetail(updatedPage, this.baseUrl);
  }

  async listSpaces(): Promise<any[]> {
    logger.info("Confluence list spaces");
    const allSpaces: any[] = [];
    let start = 0;
    const limit = 50;

    while (true) {
      const response = await this.requestWithRetry<any>(
        "GET",
        "/rest/api/space",
        { start, limit }
      );

      allSpaces.push(...response.results);
      logger.info(`Fetched ${allSpaces.length} spaces so far`);

      if (!response._links?.next || response.size < limit) {
        break;
      }
      start += limit;
    }

    return allSpaces;
  }

  private async requestWithRetry<T>(method: "GET" | "POST" | "PUT", path: string, dataOrParams?: any): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const config = {
          method,
          url: path,
          ...(method === "GET" ? { params: dataOrParams } : { data: dataOrParams }),
        };
        const response = await this.client.request<T>(config);
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
