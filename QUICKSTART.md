# Quickstart

## Prerequisites

- Node.js 20+
- At least one of: `claude`, `codex`, `gemini`, `copilot` CLI installed and
  authenticated, **or** a local Ollama (`ollama serve`) / llama.cpp
  OpenAI-compatible server running.

## 1. Install and build

```bash
git clone <this-repo>
cd ai-orchestrator
npm install
npm run build
```

(`scripts/install.sh` does the same, plus a Node-version check.)

## 2. Point the config at the agents you have

Edit `packages/orchestrator/config/agents.yaml` (and/or
`packages/agentic-team/config/agents.yaml`): set `enabled: true` only for
the agents whose CLI/endpoint you actually have. Then check it:

```bash
npm run orchestrator -- validate
npm run agentic-team -- validate
```

## 3. Run something

```bash
# Interactive shells
npm run orchestrator -- shell
npm run agentic-team -- shell

# One-shot
npm run orchestrator -- run "Create a Python REST API" --workflow default
npm run agentic-team -- run "Build a REST API with auth"

# Web UIs
npm run run-ui            # http://localhost:5001
npm run run-agentic-ui    # http://localhost:5002
npm run context-dashboard # http://localhost:5003

# Graphify: turn a project into a knowledge graph
npm run graphify -- scan .
npm run graphify -- search "class User" --project .
npm run graphify -- stats .

# MCP server (for Claude Desktop / IDE MCP clients), over stdio
npm run mcp-server
```

## 4. Verify

```bash
npm run orchestrator -- --help
npm run orchestrator -- agents
npm run orchestrator -- workflows
npm test
```

## Docker Compose (all core services at once)

```bash
docker compose up --build -d
# orchestrator-ui   → :5001
# agentic-team-ui   → :5002
# context-dashboard → :5003
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for Kubernetes and systemd.
