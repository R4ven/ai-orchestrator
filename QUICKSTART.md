# Quickstart

## Prerequisites

- Node.js 20+
- Nothing else is required. Optionally: [Ollama](https://ollama.com) running
  locally (`ollama serve`) for local models, and/or one of `claude`,
  `codex`, `gemini`, `copilot` CLI installed and authenticated for cloud
  agents — the app works with any combination of these, including none.

## Run it

```bash
git clone <this-repo>
cd ai-orchestrator
npm install
npm start
```

`npm start` builds the engine packages and launches the Electron app —
that's the entire setup. **This is the only process you need running.**
Nothing else has to run alongside it in another terminal.

The app has three tabs:

- **Orchestrator** — type a task, pick a workflow, watch each step execute live.
- **Agentic Team** — type a task, watch the roles discuss it until the lead delivers a result.
- **Local Models** — Ollama connectivity check, install/remove local models.

If Ollama is running, local agents work immediately with no configuration.
For cloud agents, install/authenticate the relevant CLI (`claude`, `codex`,
`gemini`, `copilot`); the app detects and uses whatever's available.

## Packaging a distributable build

```bash
npm run dist:mac --workspace=@ai-orchestrator/desktop   # or dist:win / dist:linux
```

See [apps/desktop/README.md](apps/desktop/README.md) for packaging details.

## Everything else is optional

The CLIs, MCP server, Graphify, and Context Dashboard are separate,
standalone tools — not required for and not used by the desktop app. Run
one only if you specifically want that tool (e.g. scripting a task without
a UI, or plugging the MCP server into an IDE):

```bash
npm run orchestrator -- shell
npm run agentic-team -- shell
npm run orchestrator -- run "Create a Python REST API" --workflow default

npm run graphify -- scan .
npm run mcp-server
npm run context-dashboard   # http://localhost:5003
```

## Verify

```bash
npm run orchestrator -- validate
npm run agentic-team -- validate
npm test
```
