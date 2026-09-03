# AI Orchestrator — Desktop (Electron)

A single desktop app for both the Orchestrator and the Agentic Team, with
local LLMs (Ollama / llama.cpp) as first-class citizens — no cloud CLI
required to get started.

## Architecture

There is **no HTTP server**. The engines (`@ai-orchestrator/orchestrator`,
`@ai-orchestrator/agentic-team`) run directly inside the Electron **main**
process; the React **renderer** talks to them exclusively through IPC,
bridged by `src/preload/index.ts`'s `window.api`:

```
renderer (React)  --ipcRenderer.invoke-->  preload  --ipcMain.handle-->  main process
                                                                            |
                                                                    Orchestrator / AgenticTeamEngine
                                                                    (same adapters/context-graph as
                                                                     the rest of the monorepo)

renderer (React)  <--ipcRenderer.on-------  preload  <--webContents.send--  main process
                     (orchestrator:step / agentic-team:turn — live progress)
```

See `src/preload/index.d.ts` for the full typed `window.api` contract.

## Local LLMs

Both `packages/orchestrator/config/agents.yaml` and
`packages/agentic-team/config/agents.yaml` enable `local-code` /
`local-instruct` (Ollama) and `local-large` (llama.cpp) by default. If
[Ollama](https://ollama.com) is running on `localhost:11434`, the app picks
it up automatically with zero configuration — see the **Local Models** tab
to check connectivity, list installed models, and pull new ones.

## Development

```bash
npm install               # from the repo root
npm run build --workspace=@ai-orchestrator/orchestrator   # and agentic-team, context-graph, shared
npm run desktop            # electron-vite dev — hot reload for the renderer
```

## Packaging

```bash
npm run desktop:build                                        # electron-vite build only
npm run dist:mac --workspace=@ai-orchestrator/desktop         # or dist:win / dist:linux
```

### Native module note (better-sqlite3)

`@ai-orchestrator/context-graph` (and transitively Graphify) use
`better-sqlite3`, a native addon. It must be built against **Electron's**
Node ABI, not your system Node's. This package's `postinstall` runs
`electron-rebuild -f -w better-sqlite3` for local development; for release
builds, `electron-builder`'s `npmRebuild: true` (already set in
`package.json`'s `build` config) rebuilds native deps automatically.

### If `npm run desktop` fails to start (ESM/CJS)

This app sets `"type": "module"` so its main/preload build stays consistent
with the rest of the monorepo's ESM packages (`electron-vite` picks its
main/preload output format — CJS vs ESM — based on this field). If you hit
a module-loading error on startup, this is the one Electron/Node version
interaction that couldn't be verified in the environment this was built in:

1. Confirm your Electron version is 28+ (main-process ESM support) — the
   pinned `^33.2.0` should be fine.
2. If it still fails, the fallback is to drop `"type": "module"` from this
   package's `package.json` (electron-vite then emits CJS for main/preload)
   and change `@ai-orchestrator/*` imports in `src/main/*.ts` to dynamic
   `await import(...)` calls, since a CJS `require()` of these ESM-only
   workspace packages needs Node's `require(esm)` support (stable in Node
   20.19+/22.12+, but not guaranteed present in every Electron-bundled Node
   build).

### Monorepo packaging note

This is an npm-workspaces monorepo, so `@ai-orchestrator/*` packages are
symlinked into `node_modules` rather than installed as regular packages.
`electron-builder`'s default file selection generally follows these
symlinks correctly, but if a packaged build is missing a workspace
package's compiled output, first confirm every dependency (`shared`,
`context-graph`, `orchestrator`, `agentic-team`) has been built
(`npm run build` from the repo root) before running `dist:*` — the
`out/main` bundle imports their `dist/index.js` at runtime rather than
bundling them.
