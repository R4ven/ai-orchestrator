# AI Orchestrator (TypeScript)

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![npm workspaces](https://img.shields.io/badge/npm-workspaces-CB3837?logo=npm&logoColor=white)
![Model Context Protocol](https://img.shields.io/badge/MCP-Model_Context_Protocol-4A90D9)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Context_Graph-003B57?logo=sqlite&logoColor=white)
![FTS5](https://img.shields.io/badge/FTS5-Full_Text_Search-003B57?logo=sqlite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-Tests-6E9F18?logo=vitest&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-Ready-326CE5?logo=kubernetes&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?logo=prometheus&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-green)

A TypeScript rebuild of [hoangsonww/AI-Agents-Orchestrator](https://github.com/hoangsonww/AI-Agents-Orchestrator):
five systems that coordinate cloud and local AI coding assistants (Claude
Code, OpenAI Codex, Gemini CLI, GitHub Copilot CLI, Ollama, llama.cpp) to
collaborate on software development tasks.

1. **Orchestrator** — step-based workflow pipeline (implement → review → refine).
2. **Agentic Team** — free role-to-role communication (PM, Architect, Developer, QA, DevOps) until the lead finalizes.
3. **Graphify** — turns a project directory into a queryable knowledge graph (SQLite + FTS5).
4. **MCP Server** — exposes both engines plus code-analysis/security/testing/DevOps/context tools to IDE assistants over the Model Context Protocol.
5. **Context Dashboard** — visualizes and searches both engines' independent context-graph memories.

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
│   ├── graphify/            # Code-graph scanner, CLI, REST API
│   └── context-dashboard/   # Aggregated dashboard for both context graphs
├── apps/
│   ├── orchestrator-ui/     # Web UI for the Orchestrator (:5001)
│   └── agentic-team-ui/     # Web UI for the Agentic Team (:5002)
└── deployment/               # Docker, Kubernetes, systemd
```

Each package builds independently (`tsc -b` with project references) and
is a real npm workspace — `import { ... } from "@ai-orchestrator/shared"` etc.

## Quick start

```bash
npm install
npm run build

npm run orchestrator -- shell            # interactive orchestrator REPL
npm run agentic-team -- shell            # interactive agentic-team REPL
npm run orchestrator -- run "Build a REST API" --workflow default

npm run run-ui            # Orchestrator web UI → http://localhost:5001
npm run run-agentic-ui    # Agentic Team web UI → http://localhost:5002
npm run context-dashboard # Context Dashboard   → http://localhost:5003
npm run mcp-server        # MCP server over stdio
npm run graphify -- scan .
```

Each system reads its own `agents.yaml`
(`packages/orchestrator/config/agents.yaml` and
`packages/agentic-team/config/agents.yaml`). Enable the CLI tools you have
installed (`claude`, `codex`, `gemini`, `copilot`) or a local Ollama/llama.cpp
endpoint, then run `npm run orchestrator -- validate` /
`npm run agentic-team -- validate` to check the config.

## Testing

```bash
npm test   # runs each package's Vitest suite
```

## What's intentionally different from the original

This is a rebuild, not a transliteration — a few deliberate calls, documented
in full in [ARCHITECTURE.md](ARCHITECTURE.md):

- **Shared adapters/resilience.** The original duplicates its adapters and
  context code between `orchestrator/` and `agentic_team/` to keep the two
  systems "zero shared code." Here, `@ai-orchestrator/shared` and
  `@ai-orchestrator/context-graph` hold that logic once; each engine still
  gets its own adapter instances, its own config, and its own context-graph
  database file, so the *behavior* (independent, isolated systems) is
  preserved without duplicating ~1,500 lines of identical TypeScript.
- **Web UIs are intentionally minimal.** Vanilla HTML/CSS/JS over
  Express + Socket.IO, not the original's Nuxt 3 + Vue 3 + Tailwind + Monaco +
  Pinia stack — this sandbox has no npm registry access to build/verify a
  frontend toolchain, and the REST + Socket.IO contract is documented so a
  fuller SPA can be swapped in later.
- **Graphify's analyzers are regex/line-based**, not a Python-`ast` parse —
  a deliberate simplification so the same analyzer logic works across
  languages without a parser dependency per language.
- **Hybrid semantic search** (BM25 + embeddings) in the context graph is not
  ported; full-text search via SQLite FTS5/BM25 is. Embeddings are a
  reasonable follow-up.
- Azure/Terraform, HAProxy/NGINX load-balancer configs, and blue-green/canary
  deploy scripts were not ported — see [DEPLOYMENT.md](DEPLOYMENT.md).

## License

MIT — same as the original project.
