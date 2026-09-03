# AI Orchestrator (TypeScript)

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![npm workspaces](https://img.shields.io/badge/npm-workspaces-CB3837?logo=npm&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-000000?logo=ollama&logoColor=white)
![Model Context Protocol](https://img.shields.io/badge/MCP-Model_Context_Protocol-4A90D9)
![SQLite](https://img.shields.io/badge/SQLite-Context_Graph-003B57?logo=sqlite&logoColor=white)
![FTS5](https://img.shields.io/badge/FTS5-Full_Text_Search-003B57?logo=sqlite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-Tests-6E9F18?logo=vitest&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-green)

A TypeScript rebuild of [hoangsonww/AI-Agents-Orchestrator](https://github.com/hoangsonww/AI-Agents-Orchestrator),
shipped as an **Electron desktop app** with a **React** UI: coordinate cloud
and local AI coding assistants (Claude Code, OpenAI Codex, Gemini CLI,
GitHub Copilot CLI, Ollama, llama.cpp) to collaborate on software
development tasks — fully usable offline with local LLMs, no cloud CLI or
API key required to get started.

1. **Orchestrator** — step-based workflow pipeline (implement → review → refine).
2. **Agentic Team** — free role-to-role communication (PM, Architect, Developer, QA, DevOps) until the lead finalizes.
3. **Desktop app** (`apps/desktop`) — the primary UI: Electron + React, talking to both engines directly via IPC (no HTTP server).
4. **Graphify** — turns a project directory into a queryable knowledge graph (SQLite + FTS5), including a PHP analyzer alongside JS/TS/Python.
5. **MCP Server** — exposes both engines plus code-analysis/security/testing/DevOps/context tools to IDE assistants over the Model Context Protocol.
6. **Context Dashboard** — visualizes and searches both engines' independent context-graph memories.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and
where this rebuild intentionally diverges from the original, and
[QUICKSTART.md](QUICKSTART.md) to get running in a few minutes.

## Project layout

```
ai-orchestrator/
├── packages/
│   ├── shared/              # Adapters (Claude/Codex/Gemini/Copilot/Ollama/llama.cpp), retry/fallback/offline
│   ├── context-graph/       # SQLite+FTS5 graph memory (used independently by orchestrator & agentic-team)
│   ├── orchestrator/        # Workflow engine, planner, CLI (`ai-orchestrator`)
│   ├── agentic-team/        # Free-communication engine, CLI (`agentic-team`)
│   ├── mcp-server/          # MCP server (25+ tools)
│   ├── graphify/            # Code-graph scanner (JS/TS, Python, PHP, config, docs), CLI, REST API
│   └── context-dashboard/   # Aggregated dashboard for both context graphs
└── apps/
    └── desktop/              # Electron + React desktop app (primary UI)
```

Each package builds independently (`tsc -b` with project references) and
is a real npm workspace — `import { ... } from "@ai-orchestrator/shared"` etc.

## Quick start

```bash
npm install
npm run build

npm run desktop            # Electron desktop app (Orchestrator, Agentic Team, Local Models)
```

Local LLMs work out of the box: if [Ollama](https://ollama.com) is running
on `localhost:11434`, both engines pick it up automatically — no cloud CLI
or config changes needed. Check the app's **Local Models** tab to verify
connectivity and pull models.

For headless/CLI use:

```bash
npm run orchestrator -- shell            # interactive orchestrator REPL
npm run agentic-team -- shell            # interactive agentic-team REPL
npm run orchestrator -- run "Build a REST API" --workflow default

npm run context-dashboard # Context Dashboard   → http://localhost:5003
npm run mcp-server        # MCP server over stdio
npm run graphify -- scan .
```

Each system reads its own `agents.yaml`
(`packages/orchestrator/config/agents.yaml` and
`packages/agentic-team/config/agents.yaml`). Cloud CLI agents (`claude`,
`codex`, `gemini`, `copilot`) are enabled by default too — the startup
health probe silently skips any you don't have installed. Run
`npm run orchestrator -- validate` / `npm run agentic-team -- validate` to
check the config.

## Packaging as a desktop app

```bash
npm run dist:mac --workspace=@ai-orchestrator/desktop    # or dist:win / dist:linux
```

See [apps/desktop/README.md](apps/desktop/README.md) for the IPC
architecture, native-module (better-sqlite3) rebuild notes, and packaging
caveats.

## Testing

```bash
npm test   # runs each package's Vitest suite
```

## What's intentionally different from the original

This is a rebuild, not a transliteration — a few deliberate calls, documented
in full in [ARCHITECTURE.md](ARCHITECTURE.md):

- **Electron + React instead of a server deployment.** The original ships
  Nuxt/Vue web UIs plus Docker/Kubernetes/systemd configs for self-hosting.
  This rebuild targets a desktop app instead: the engines run in-process in
  Electron's main process (IPC, not HTTP), and local LLMs are first-class
  (enabled by default, no cloud CLI required) rather than an offline
  fallback. Server-style deployment configs were removed as out of scope.
- **Shared adapters/resilience.** The original duplicates its adapters and
  context code between `orchestrator/` and `agentic_team/` to keep the two
  systems "zero shared code." Here, `@ai-orchestrator/shared` and
  `@ai-orchestrator/context-graph` hold that logic once; each engine still
  gets its own adapter instances, its own config, and its own context-graph
  database file, so the *behavior* (independent, isolated systems) is
  preserved without duplicating ~1,500 lines of identical TypeScript.
- **Graphify's analyzers are regex/line-based**, not a Python-`ast` parse —
  a deliberate simplification so the same analyzer logic works across
  languages (JS/TS, Python, PHP, config, docs) without a parser dependency
  per language.
- **Hybrid semantic search** (BM25 + embeddings) in the context graph is not
  ported; full-text search via SQLite FTS5/BM25 is. Embeddings are a
  reasonable follow-up.

## License

MIT — same as the original project.
