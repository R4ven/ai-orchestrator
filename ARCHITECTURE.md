# Architecture

## Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              @ai-orchestrator/shared          │
                    │  BaseAdapter, CLICommunicator, 6 adapters,     │
                    │  retry/circuit-breaker/rate-limiter, fallback, │
                    │  offline detection, logger, exceptions         │
                    └───────────────┬─────────────────┬─────────────┘
                                    │                 │
                ┌───────────────────┘                 └───────────────────┐
                │                                                         │
   ┌────────────▼────────────┐                             ┌─────────────▼────────────┐
   │  @ai-orchestrator/       │                             │  @ai-orchestrator/         │
   │  orchestrator             │                             │  agentic-team               │
   │  Engine, WorkflowEngine,  │                             │  Engine (free role comms),  │
   │  PlannerAgent, metrics,   │                             │  DecisionParser, role       │
   │  reports, security, CLI   │                             │  prompts, config, CLI       │
   └────────────┬────────────┘                             └─────────────┬────────────┘
                │                                                         │
                └───────────────────┐                 ┌───────────────────┘
                                    │                 │
                    ┌───────────────▼─────────────────▼─────────────┐
                    │          @ai-orchestrator/context-graph          │
                    │   SQLite + FTS5 graph store, MemoryManager,       │
                    │   project scanner — each caller opens its own DB  │
                    └───────────────────────────────────────────────┘

   apps/desktop (Electron main process, IPC — no HTTP server)   packages/context-dashboard (:5003, optional)
   packages/mcp-server (stdio)    packages/graphify (CLI + REST API, independent SQLite+FTS5 graph)
```

## Package responsibilities

### `@ai-orchestrator/shared`

- `adapters/base.ts` — `BaseAdapter` abstract class: availability checks
  (`which`), prompt formatting, HTTP/CLI execution helpers.
- `adapters/cliCommunicator.ts` — spawns CLI tools with four communication
  patterns (`stdin`, `file`, `arg`, `heredoc`), workspace file-change
  tracking, retry-with-method-fallback, and an `AgentCLIRegistry` of known
  tool invocation shapes (Claude/Codex/Gemini/Copilot).
- `adapters/{claude,codex,gemini,copilot}Adapter.ts` — CLI-backed adapters,
  each with tool-specific prompt building and output parsing (suggestions,
  modified files).
- `adapters/{ollama,llamaCpp}Adapter.ts` — HTTP-backed local-model adapters
  (`/api/generate` and `/v1/completions` respectively), advisory-only (no
  direct file writes — same safety stance as the original).
- `resilience/retry.ts` — `retryOnError`, `CircuitBreaker`, `RateLimiter`.
- `resilience/fallback.ts` — `FallbackManager`: cloud-to-local routing on
  network/5xx-shaped failures.
- `resilience/offline.ts` — `OfflineDetector` with cached connectivity checks.
- `logger.ts` — leveled, namespaced logging. **Always writes to stderr**,
  never stdout — required so the MCP server's stdio JSON-RPC transport isn't
  corrupted, and good practice for any CLI besides.

### `@ai-orchestrator/context-graph`

A graph-based persistent memory: `Node`/`Edge` types (`NodeType`: task,
mistake, pattern, decision, code_snippet, preference, file, concept,
agent_output, project, conversation; `EdgeType`: related_to, caused_by,
fixed_by, similar_to, depends_on, ...), a WAL-mode SQLite `GraphStore` with
an FTS5 index for full-text search, a `MemoryManager` high-level API
(`storeTask`, `storeMistake`, `storePattern`, `storeDecision`,
`registerProject`, `getRelevantContext`), and a deterministic project
scanner (`generateProjectId` = SHA-256 prefix of the normalized path).

Both the Orchestrator and Agentic Team import this package but each opens
its **own** database file (`~/.ai-orchestrator/context.db` and
`~/.agentic-team/context.db` respectively) — they share code, not data.

### `@ai-orchestrator/orchestrator`

- `core/engine.ts` — `Orchestrator`: loads `agents.yaml`, resolves offline
  mode, constructs and probes adapters (`checkAvailability()` — sync PATH
  lookup for CLI adapters, async HTTP health probe for local ones), runs
  the iteration loop (up to `max_iterations`, stopping early once a
  review step reports ≤3 suggestions), generates reports, and stores the
  task in context memory.
- `core/workflow.ts` — `WorkflowStep`/`WorkflowEngine`: turns a step config
  into a task description (`"Implement the following: ..."`,
  `"Review the implementation of: ..."`, etc.) and step-scoped context.
- `core/planner.ts` — `PlannerAgent`: the `dynamic` workflow. Ranks agents
  by historical success rate (from Prometheus counters), asks the
  best-available agent to propose a JSON step plan, validates/repairs it.
- `core/taskManager.ts` — in-memory task lifecycle tracking (mirrors the
  original; not deeply wired into the engine, same as upstream).
- `observability/metrics.ts` — `prom-client`-backed counters/histograms
  (`orchestrator_tasks_total`, `orchestrator_agent_calls_total`, ...). Not
  wired to an HTTP `/metrics` endpoint in the desktop app (no server); the
  `MetricsCollector` is still available for anything that wants to expose
  or inspect it (e.g. a future export/telemetry panel).
- `observability/health.ts`, `reportGenerator.ts` — health probes and
  JSON/HTML execution reports (`reports/exec_*.json`, `dashboard_*.html`).
- `security/security.ts` — `InputValidator` (task/workflow/agent-name/path
  validation, dangerous-pattern rejection), `TokenBucketRateLimiter`,
  `SecretManager`, `AuditLogger`.
- `infra/configManager.ts` — YAML config loading, defaults, and
  `validateConfig()` (used by the `validate` CLI command).
- `cli/` — commander-based CLI (`shell`, `run`, `agents`, `workflows`,
  `validate`) and an interactive REPL (`/help`, `/agents`, `/workflow`,
  `/save`, `/load`, `/project`, ...).

### `@ai-orchestrator/agentic-team`

- `engine.ts` — `AgenticTeamEngine`: same adapter-resolution logic as the
  Orchestrator (independently implemented, per the "self-contained systems"
  design), but executes a **turn loop**: each turn asks the current role's
  agent for a JSON routing decision (`action: "message"|"finalize"`,
  `to_role`, `message`), truncates over-long messages, redirects
  non-lead `finalize` attempts back to the lead, escalates repeated
  routing loops to the lead, and stops on `finalize` or `max_turns`.
- `decisionParser.ts` — extracts a JSON object from model output via direct
  parse → fenced-code-block scan → brace-counting streaming scan → key-value
  line fallback (`action: message`, `to_role: qa_engineer`, ...).
- `configUtils.ts` — `resolveTeamConfig` (defaults + `agentic_team.roles`
  overrides, string-or-object role specs), `validateTeamBindings`.
- `prompts/teamPrompts.ts` — per-role system prompts (PM/Architect/
  Developer/QA/DevOps) plus the shared communication protocol, roster, and
  recent-transcript context injected into every turn's prompt.

### `@ai-orchestrator/mcp-server`

A stdio-transport MCP server (`@modelcontextprotocol/sdk`) exposing:
`orchestrator_*`, `agentic_team_*`, context-memory tools
(`store_task`, `search_context`, `get_relevant_context`, ...), code-analysis
tools (`analyze_complexity`, `find_code_patterns`, ...), security tools
(`scan_secrets`, `detect_injection_vulnerabilities`, ...), testing tools
(`generate_test_cases`, `analyze_test_coverage`, ...), and DevOps tools
(`generate_dockerfile`, `analyze_deployment_config`, ...). See
`packages/mcp-server/src/tools/` for the full list and
`packages/mcp-server/src/engines.ts` for how both engines are initialized
once and shared across tool calls.

### `@ai-orchestrator/graphify`

An independent SQLite+FTS5 knowledge graph *of code*, separate from the
context-graph memory: `PROJECT`/`DIRECTORY`/`FILE`/`CLASS`/`FUNCTION`/
`IMPORT`/`CONFIG`/`DOCUMENTATION`/`TEST` nodes connected by `CONTAINS`/
`IMPORTS`/`TESTS`/`DOCUMENTS`/`CONFIGURED_BY` edges. `Scanner` walks a
project tree and dispatches each file to the first `Analyzer` that supports
its `Language` (JS/TS, Python, **PHP**, JSON/YAML/TOML config, Markdown
docs — see the README for why these are regex-based rather than full AST
parses; the PHP analyzer extracts classes/interfaces/traits, functions, and
`use`/`require`/`include` imports the same way the JS/Python ones do).
`GraphStore` adds BFS path-finding and "most connected node" analysis on
top of the same node/edge/FTS5 pattern as `context-graph`. Exports to JSON,
DOT, Markdown, GraphML; a small Express API mirrors the CLI's `search`/
`stats`/`path`/`export` commands over HTTP.

### `@ai-orchestrator/context-dashboard`

Opens both engines' context-graph databases read-only (closing each after
every request — no long-lived connection to either), aggregates node/edge
counts, and serves a single-page dashboard with live cross-graph full-text
search.

### `apps/desktop`

The primary UI: an Electron app (main + preload + React renderer, built
with `electron-vite`). **No HTTP server** — `Orchestrator` and
`AgenticTeamEngine` run directly inside the Electron main process
(`src/main/ipc.ts`), and the React renderer talks to them exclusively over
IPC:

- `ipcMain.handle('orchestrator:run', ...)` / `'agentic-team:run'` —
  request/response, same shape as the old REST calls.
- `mainWindow.webContents.send('orchestrator:step', ...)` /
  `'agentic-team:turn'` — streamed progress, replacing the old Socket.IO
  events.
- `src/preload/index.ts` bridges both via `contextBridge.exposeInMainWorld`,
  fully typed for the renderer through `src/preload/index.d.ts`'s
  `window.api`.

The React UI (`src/renderer/src`) has three tabs: **Orchestrator**,
**Agentic Team** (both mirroring the previous web UIs' run-and-watch-progress
flow), and **Local Models** — an Ollama health check, installed-model list,
and pull/remove controls, since local LLMs are meant to work out of the box
here with no cloud CLI configured. See [apps/desktop/README.md](apps/desktop/README.md)
for the IPC contract diagram and native-module (better-sqlite3) packaging
notes.

## Data flow: one Orchestrator task

```
CLI/UI → Orchestrator.executeTask(task, workflow)
  → resolve workflow steps (static config, or PlannerAgent for "dynamic")
  → for each iteration (up to max_iterations):
      for each WorkflowStep:
        → FallbackManager.executeWithFallback(primaryAgent, ...)
            → adapter.executeTask(task, context)
                → BaseAdapter.runCommandWithPrompt(...)
                    → CLICommunicator.executeInWorkspace / executeWithRetry
                        → child_process.spawn(...)
            → on recoverable failure, retry via the configured fallback agent
        → update context (previous_output, feedback/implementation, ...)
      → stop early if all steps succeeded with ≤3 review suggestions
  → maybe write a JSON execution report (settings.create_reports)
  → store the task outcome in the context graph (MemoryManager.storeTask)
```

The Agentic Team's turn loop follows the same "adapter → fallback →
context-graph" shape, but routes by `to_role` (resolved to an agent via
`agents.yaml`'s `agentic_team.roles`) instead of a fixed step sequence.

## Testing strategy

Each package ships a focused Vitest suite for its pure/deterministic logic
(config resolution and validation, retry/circuit-breaker/fallback behavior,
decision parsing, graph storage) rather than attempting to mock every CLI
subprocess or HTTP call — see `packages/*/src/**/*.test.ts`.
