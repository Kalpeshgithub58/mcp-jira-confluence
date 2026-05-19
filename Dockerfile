# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Production stage
FROM node:18-alpine

LABEL org.opencontainers.image.title="MCP Server for Jira & Confluence" \
      org.opencontainers.image.description="Official MCP server providing 12 powerful tools for Jira (Create/Edit/Search) and Confluence (Search/Create) in self-hosted environments. Track updates at https://github.com/Kalpeshgithub58/mcp-jira-confluence" \
      org.opencontainers.image.source="https://github.com/Kalpeshgithub58/mcp-jira-confluence" \
      org.opencontainers.image.authors="AgentCraftAI" \
      com.agentcraftai.category="AI Agent Tools / Developer Productivity"

WORKDIR /app

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER appuser

EXPOSE 8000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
