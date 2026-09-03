# Quickstart

## Prerequisites

- Node.js 20+
- Optional: [Ollama](https://ollama.com) running locally (`ollama serve`) for
  fully offline use, and/or one of `claude`, `codex`, `gemini`, `copilot`
  CLI installed and authenticated for cloud agents. Neither is required to
  install and build — the app just has fewer available agents until you add
  one.

## 1. Install and build

```bash
git clone <this-repo>
cd ai-orchestrator
npm install
npm run build
```

(`scripts/install.sh` does the same, plus a Node-version check.)

## 2. Launch the desktop app

```bash
npm run desktop
```

Opens the Electron app with three tabs: **Orchestrator**, **Agentic Team**,
and **Local Models**. If Ollama is running, local agents are detected
automatically — check the Local Models tab to confirm connectivity and pull
a model if you don't have one yet (e.g. `codellama:13b` or
`mistral:7b-instruct`).

To package a distributable build: see
[apps/desktop/README.md](apps/desktop/README.md).

## 3. (Optional) point the config at cloud agents you have

Edit `packages/orchestrator/config/agents.yaml` (and/or
`packages/agentic-team/config/agents.yaml`) if you want to use `claude`,
`codex`, `gemini`, or `copilot` — they're enabled by default but only
actually used once their CLI is installed and authenticated. Then check the
config:

```bash
npm run orchestrator -- validate
npm run agentic-team -- validate
```

## 4. Headless / CLI use

```bash
# Interactive shells
npm run orchestrator -- shell
npm run agentic-team -- shell

# One-shot
npm run orchestrator -- run "Create a Python REST API" --workflow default
npm run agentic-team -- run "Build a REST API with auth"

# Graphify: turn a project into a knowledge graph (JS/TS, Python, PHP, config, docs)
npm run graphify -- scan .
npm run graphify -- search "class User" --project .
npm run graphify -- stats .

# MCP server (for Claude Desktop / IDE MCP clients), over stdio
npm run mcp-server

# Context Dashboard (optional, visualizes both context graphs)
npm run context-dashboard # http://localhost:5003
```

## 5. Verify

```bash
npm run orchestrator -- --help
npm run orchestrator -- agents
npm run orchestrator -- workflows
npm test
```
