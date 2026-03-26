<div align="center">

# 🔗 Jira & Confluence MCP Server

**Connect your AI-powered editor to self-hosted Jira and Confluence**

[![Docker](https://img.shields.io/badge/Docker-Hub-blue?logo=docker)](https://hub.docker.com/r/agentcraftai/mcp-jira-confluence)
[![MCP](https://img.shields.io/badge/MCP-Compatible-green)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)

Query Jira tickets and Confluence pages directly from your AI editor — no browser tab switching required.

Works with **Antigravity**, **Windsurf**, **VS Code**, and any MCP-compatible client.

</div>

---

## 📋 Table of Contents

- [What is this?](#what-is-this)
- [Quick Start](#-quick-start)
- [Available Tools](#-available-tools)
- [Editor Configuration](#-editor-configuration)
- [Configuration Reference](#-configuration-reference)
- [Local Development](#-local-development)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## What is this?

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI assistants in your editor **directly access Jira and Confluence**.

Instead of switching to a browser, you ask your AI editor:
> *"How many tickets are assigned to me in the last 15 days?"*

The AI calls the MCP tool, the server queries your Jira instance, and you get the answer — all within your editor.

```
You (in editor)              MCP Server                Jira / Confluence
     │                           │                            │
     │  "Show my tickets"        │                            │
     │ ────────────────────►     │                            │
     │                           │  REST API + your PAT       │
     │                           │ ────────────────────►      │
     │                           │  ◄──── JSON ──────         │
     │  ◄── Formatted answer ─── │                            │
```

---

## 🚀 Quick Start

### Prerequisites

- Docker installed on your machine
- A Personal Access Token (PAT) from your Jira instance
- A Personal Access Token (PAT) from your Confluence instance

> **How to get a PAT:** Go to your Jira/Confluence → Profile → Personal Access Tokens → Create Token

### Step 1: Pull and Run

You can find the official image on [Docker Hub](https://hub.docker.com/r/agentcraftai/mcp-jira-confluence).

```bash
# Pull the latest image
docker pull agentcraftai/mcp-jira-confluence

# Run the container
docker run -d \
  --name mcp-jira-confluence \
  -p 3000:3000 \
  -e JIRA_BASE_URL=https://jira.yourcompany.com \
  -e JIRA_PAT=your_jira_token \
  -e CONFLUENCE_BASE_URL=https://confluence.yourcompany.com \
  -e CONFLUENCE_PAT=your_confluence_token \
  agentcraftai/mcp-jira-confluence
```

### Step 2: Verify

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{ "status": "ok", "server": "jira-confluence-mcp", "version": "1.0.0" }
```

### Step 3: Configure Your Editor

Add this to your editor's MCP settings (see [Editor Configuration](#-editor-configuration)):

```json
{
  "servers": [
    {
      "name": "jira-confluence",
      "url": "http://localhost:3000/mcp"
    }
  ]
}
```

**No tokens in the editor config** — the server handles authentication internally.

### Step 4: Start Asking Questions

Open your AI editor and ask:
- *"Show my Jira tickets from the last 7 days"*
- *"Search for all open bugs in project XYZ"*
- *"Find Confluence pages about deployment"*
- *"Get details of ticket PROJ-456"*

---

## 🛠 Available Tools

### Jira Tools

| Tool | Description | Example Input |
|------|-------------|---------------|
| `getMyTickets` | Fetch issues assigned to you, updated in the last N days | `{ "lastNDays": 15 }` |
| `searchJira` | Search using any JQL query | `{ "jql": "project = PROJ AND status = Open" }` |
| `getIssueDetails` | Get full details of a specific issue | `{ "issueKey": "PROJ-123" }` |
| `createIssue` | Create a new Jira issue (epic, story, task, bug) | `{ "projectKey": "PROJ", "summary": "Fix auth", "description": "...", "issueType": "Bug" }` |
| `addComment` | Add a comment to an existing issue | `{ "issueKey": "PROJ-123", "body": "Fixed in PR #45" }` |
| `updateIssue` | Transition an issue to a new status via transition ID | `{ "issueKey": "PROJ-123", "transitionId": "31" }` |
| `editIssue` | Edit any combination of fields on an existing issue | `{ "issueKey": "PROJ-123", "summary": "New title", "priority": "High" }` |
| `listProjects` | List all accessible Jira projects | `{}` |

### Confluence Tools

| Tool | Description | Example Input |
|------|-------------|---------------|
| `searchPages` | Search pages by keyword | `{ "query": "deployment guide" }` |
| `getPage` | Get full content of a page by ID | `{ "pageId": "12345" }` |
| `listSpaces` | List all accessible Confluence spaces | `{}` |
| `createPage` | Create a new Confluence page | `{ "spaceKey": "DOCS", "title": "New Title", "content": "<h1>HTML Body Here</h1>" }` |

### Example Responses

**getMyTickets** response:
```json
{
  "tickets": [
    {
      "key": "PROJ-101",
      "summary": "Fix authentication timeout",
      "status": "In Progress",
      "priority": "High",
      "assignee": "Kalpesh Sarvaiya",
      "updated": "2026-03-21",
      "type": "Bug",
      "project": "PROJ"
    }
  ],
  "total": 1
}
```

**searchPages** response:
```json
{
  "pages": [
    {
      "id": "98765",
      "title": "Deployment Guide",
      "space": "DEV",
      "spaceName": "Development",
      "status": "current",
      "url": "https://confluence.yourcompany.com/display/DEV/Deployment+Guide"
    }
  ],
  "total": 1
}
```

---

## 🔌 Editor Configuration

### Antigravity

Add to your MCP server configuration:
```json
{
  "servers": [
    {
      "name": "jira-confluence",
      "url": "http://localhost:3000/mcp"
    }
  ]
}
```

### VS Code (with MCP extension)

Add to your MCP settings:
```json
{
  "servers": [
    {
      "name": "jira-confluence",
      "url": "http://localhost:3000/mcp"
    }
  ]
}
```

### Windsurf

Windsurf uses a **different config format** — edit `%USERPROFILE%\.codeium\windsurf\mcp_config.json`:
```json
{
  "mcpServers": {
    "jira-confluence": {
      "serverUrl": "http://localhost:3000/sse"
    }
  }
}
```

> **⚠️ Important:** Windsurf uses `mcpServers` (object), `serverUrl`, and the `/sse` endpoint. Other editors use `servers` (array), `url`, and the `/mcp` endpoint. Always use `http://` — NOT `https://`.

---

## ⚙ Configuration Reference

### Independent Services

**Jira and Confluence are fully independent.** You can use one without the other. If one token expires or is missing, the other service continues working normally.

| Scenario | What happens |
|----------|-------------|
| Only Jira configured | ✅ Jira tools work · Confluence tools return "not configured" message |
| Only Confluence configured | ✅ Confluence tools work · Jira tools return "not configured" message |
| Both configured | ✅ All tools work |
| Jira token expires | ❌ Jira tools return auth error · ✅ Confluence tools unaffected |
| Confluence token expires | ✅ Jira tools unaffected · ❌ Confluence tools return auth error |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_BASE_URL` | For Jira tools | Your Jira instance URL (e.g., `https://jira.yourcompany.com`) |
| `JIRA_PAT` | For Jira tools | Jira Personal Access Token |
| `CONFLUENCE_BASE_URL` | For Confluence tools | Your Confluence instance URL (e.g., `https://confluence.yourcompany.com`) |
| `CONFLUENCE_PAT` | For Confluence tools | Confluence Personal Access Token |
| `PORT` | No | Server port (default: `3000`) |

### Usage Examples

**Jira only:**
```bash
docker run -d -p 3000:3000 \
  -e JIRA_BASE_URL=https://jira.yourcompany.com \
  -e JIRA_PAT=your_jira_token \
  agentcraftai/mcp-jira-confluence
```

**Confluence only:**
```bash
docker run -d -p 3000:3000 \
  -e CONFLUENCE_BASE_URL=https://confluence.yourcompany.com \
  -e CONFLUENCE_PAT=your_confluence_token \
  agentcraftai/mcp-jira-confluence
```

**Both:**
```bash
docker run -d -p 3000:3000 \
  -e JIRA_BASE_URL=https://jira.yourcompany.com \
  -e JIRA_PAT=your_jira_token \
  -e CONFLUENCE_BASE_URL=https://confluence.yourcompany.com \
  -e CONFLUENCE_PAT=your_confluence_token \
  agentcraftai/mcp-jira-confluence
```

### Using Docker Compose

Create a `.env` file (include only the services you need):

```env
JIRA_BASE_URL=https://jira.yourcompany.com
JIRA_PAT=your_jira_token
CONFLUENCE_BASE_URL=https://confluence.yourcompany.com
CONFLUENCE_PAT=your_confluence_token
```

Run:

```bash
docker compose up -d
```

### Security

- ✅ Tokens are passed as environment variables only
- ✅ Tokens are **never** logged or exposed in API responses
- ✅ Logger automatically redacts token-like patterns
- ✅ No tokens in client configuration files
- ✅ Docker container runs as non-root user

---

## 💻 Local Development

```bash
# Clone the repo
git clone https://github.com/Kalpeshgithub58/mcp-jira-confluence.git
cd mcp-jira-confluence

# Install dependencies
npm install

# Build TypeScript
npm run build

# Set environment variables and run
# (Linux/Mac)
export JIRA_BASE_URL=https://jira.yourcompany.com
export JIRA_PAT=your_token
export CONFLUENCE_BASE_URL=https://confluence.yourcompany.com
export CONFLUENCE_PAT=your_token
npm start

# (Windows PowerShell)
$env:JIRA_BASE_URL="https://jira.yourcompany.com"
$env:JIRA_PAT="your_token"
$env:CONFLUENCE_BASE_URL="https://confluence.yourcompany.com"
$env:CONFLUENCE_PAT="your_token"
npm start
```

### Build Docker Image Locally

```bash
docker build -t mcp-jira-confluence .
```

---

## 🏗 Architecture

| Component | Detail |
|-----------|--------|
| **Runtime** | Node.js 18 (Alpine) |
| **Language** | TypeScript |
| **MCP Transport** | Streamable HTTP (`/mcp`) + Legacy SSE (`/sse`) for backward compatibility |
| **HTTP Framework** | Express |
| **API Client** | Axios |
| **Endpoints** | `POST /mcp`, `GET /mcp`, `DELETE /mcp` (Streamable HTTP) · `GET /sse`, `POST /messages` (Legacy SSE) · `GET /health` |

### Key Features

- **Full pagination** — All list endpoints auto-paginate. No partial results ever returned.
- **Rate limit handling** — Exponential backoff on HTTP 429 (1s → 2s → 4s, up to 3 retries).
- **Clean error mapping** — `401` → auth error, `403` → permission error, network issues → connection error.
- **LLM-optimized responses** — Minimal, clean JSON. No raw API payloads.
- **Session management** — Per-client MCP sessions with proper lifecycle.

---

## 📁 Project Structure

```
├── src/
│   ├── index.ts                  # Express server + MCP transport setup
│   ├── config.ts                 # Environment variable loading & validation
│   ├── logger.ts                 # Structured logger with token redaction
│   ├── clients/
│   │   ├── jira-client.ts        # Jira REST API client (pagination + retry)
│   │   └── confluence-client.ts  # Confluence REST API client (pagination + retry)
│   └── tools/
│       ├── jira.ts               # getMyTickets, searchJira, getIssueDetails
│       └── confluence.ts         # searchPages, getPage
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # One-command deployment
├── mcp_config.json               # Example client configuration
├── .env.example                  # Template environment variables
├── package.json
└── tsconfig.json
```

---

## 🔧 Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `Unable to connect to remote server` | Server not running | Start the container: `docker start mcp-jira-confluence` |
| `Jira authentication failed` | Invalid or expired PAT | Generate a new PAT in Jira → Profile → Personal Access Tokens |
| `Jira access denied` | PAT lacks permissions | Ensure your PAT has read access to the required projects |
| `Confluence authentication failed` | Invalid or expired PAT | Generate a new PAT in Confluence |
| `Jira/Confluence not configured` | Missing env vars | Pass all required env vars via `-e` flags or `.env` file |
| `Connection refused` to Jira/Confluence | Network issue | Verify the container can reach your Jira/Confluence URLs |
| Editor can't connect to MCP | Wrong URL | Use `http://localhost:3000/mcp` (not just `localhost:3000`) |

### Check Container Logs

```bash
docker logs mcp-jira-confluence
```

### Restart Container

```bash
docker restart mcp-jira-confluence
```

---

## 📄 License

MIT

---

<div align="center">

**Built with ❤️ for developer productivity**

[Report Bug](https://github.com/Kalpeshgithub58/mcp-jira-confluence/issues) · [Request Feature](https://github.com/Kalpeshgithub58/mcp-jira-confluence/issues)

</div>
