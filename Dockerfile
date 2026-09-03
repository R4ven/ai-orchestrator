# Multi-stage production Dockerfile for the AI Orchestrator monorepo.
# Builds every workspace package/app and produces a slim runtime image.
# The same image serves all services; select one via CMD (see docker-compose.yml).

# ─────────────────────────────────────────────
# Stage 1: Builder — install deps and compile TypeScript
# ─────────────────────────────────────────────
FROM node:22-slim AS builder

LABEL description="AI Orchestrator — Builder Stage"
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Layer-cache friendly: copy manifests first.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/context-graph/package.json packages/context-graph/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/agentic-team/package.json packages/agentic-team/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/graphify/package.json packages/graphify/
COPY packages/context-dashboard/package.json packages/context-dashboard/
COPY apps/orchestrator-ui/package.json apps/orchestrator-ui/
COPY apps/agentic-team-ui/package.json apps/agentic-team-ui/

RUN npm install

COPY . .
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Runtime — minimal production image
# ─────────────────────────────────────────────
FROM node:22-slim

LABEL description="AI Orchestrator — Production Runtime"

ENV NODE_ENV=production \
    PORT=5001 \
    LOG_LEVEL=info

RUN groupadd -r -g 1000 appuser && useradd -r -u 1000 -g appuser -m -s /bin/bash appuser

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /build/package.json /build/package-lock.json* ./
COPY --from=builder --chown=appuser:appuser /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /build/packages ./packages
COPY --from=builder --chown=appuser:appuser /build/apps ./apps

RUN mkdir -p /app/output /app/workspace /app/reports /app/sessions /app/logs \
    /home/appuser/.ai-orchestrator /home/appuser/.agentic-team \
    && chown -R appuser:appuser /app /home/appuser/.ai-orchestrator /home/appuser/.agentic-team

USER appuser

# orchestrator UI on 5001, agentic team UI on 5002, context dashboard on 5003, MCP server on 8000
EXPOSE 5001
EXPOSE 5002
EXPOSE 5003
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f "http://localhost:${PORT:-5001}/api/health" || curl -f "http://localhost:${PORT:-5001}/health" || exit 1

VOLUME ["/app/workspace", "/app/sessions", "/app/logs", "/app/output", "/home/appuser/.ai-orchestrator", "/home/appuser/.agentic-team"]

# Default: run the Orchestrator UI. Override CMD in compose/K8s for the other services.
CMD ["node", "apps/orchestrator-ui/dist/server.js"]
