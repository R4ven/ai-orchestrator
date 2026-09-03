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
shipped as **one Electron desktop app**: type a task, pick Orchestrator or
Agentic Team, and watch it get worked on live. Local LLMs (via
[Ollama](https://ollama.com)) work with zero setup — no cloud CLI, no API
key, no server to run.

**There is exactly one thing you run: `npm start`.** It opens the app; the
engines run inside it. Nothing else needs to be running in another
terminal. (Everything below the Quick Start — the CLIs, the MCP server, the
dashboard — is optional tooling for other use cases, not part of using the
app.)

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and
where this rebuild intentionally diverges from the original.

## Quick start

```bash
npm install
npm start
```

That's it — `npm start` builds the four engine packages the app needs
(`shared`, `context-graph`, `orchestrator`, `agentic-team`) and launches the
Electron app in one step. The app has three tabs:

- **Orchestrator** — enter a task, pick a workflow, watch each step run live.
- **Agentic Team** — enter a task, watch the roles (PM/Architect/Developer/QA/DevOps) discuss it in real time until the lead delivers a result.
- **Local Models** — check Ollama connectivity, list/pull/remove local models. If Ollama is running on `localhost:11434`, it's picked up automatically — no config changes needed.

Cloud CLI agents (`claude`, `codex`, `gemini`, `copilot`) are also enabled
by default; the app silently skips any whose CLI isn't installed. To enable/
disable specific agents, edit `packages/orchestrator/config/agents.yaml`
and `packages/agentic-team/config/agents.yaml`.

To build a distributable installer instead of running in dev mode:

```bash
npm run dist:mac --workspace=@ai-orchestrator/desktop    # or dist:win / dist:linux
```

See [apps/desktop/README.md](apps/desktop/README.md) for the IPC
architecture, native-module (better-sqlite3) rebuild notes, and packaging
caveats.

## Project layout

```
ai-orchestrator/
├── packages/
│   ├── shared/              # Adapters (Claude/Codex/Gemini/Copilot/Ollama/llama.cpp), retry/fallback/offline
│   ├── context-graph/       # SQLite+FTS5 graph memory (used independently by orchestrator & agentic-team)
│   ├── orchestrator/        # Workflow engine, planner — powers the app's Orchestrator tab
│   ├── agentic-team/        # Free-communication engine — powers the app's Agentic Team tab
│   ├── mcp-server/          # optional: MCP server (25+ tools) for IDE assistants
│   ├── graphify/            # optional: code-graph scanner (JS/TS, Python, PHP, config, docs) CLI + REST API
│   └── context-dashboard/   # optional: web dashboard over both context graphs
└── apps/
    └── desktop/              # the Electron + React app — this is what `npm start` runs
```

Each package builds independently (`tsc -b` with project references) and
is a real npm workspace — `import { ... } from "@ai-orchestrator/shared"` etc.
`orchestrator` and `agentic-team` also ship their own CLIs
(`npm run orchestrator -- shell`, etc.) for headless/scripted use — see
"Optional additional tools" below — but neither the app nor those CLIs
depend on the other running.

## Testing

```bash
npm test   # runs each package's Vitest suite
```

## Optional additional tools

None of these are needed to use the app — they're separate, standalone
pieces for other use cases (scripting, IDE integration, visualizing the
context graph). Each is its own process you'd run *instead of*, not
*alongside*, the desktop app, only if you specifically want that tool:

```bash
npm run orchestrator -- shell            # interactive orchestrator REPL (no UI)
npm run agentic-team -- shell            # interactive agentic-team REPL (no UI)
npm run orchestrator -- run "Build a REST API" --workflow default

npm run mcp-server        # MCP server over stdio, for Claude Desktop / IDE MCP clients
npm run graphify -- scan .   # turn a project into a queryable code graph
npm run context-dashboard # web dashboard over both engines' context graphs → http://localhost:5003
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
