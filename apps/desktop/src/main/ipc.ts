/** IPC bridge between the renderer (React UI) and the Node engines.
 *
 * There is no HTTP server in the desktop app: the engines run directly in
 * the Electron main process, and the renderer talks to them exclusively via
 * `ipcMain.handle` (request/response) and `webContents.send` (streamed
 * progress events), exposed to the renderer through the preload script's
 * `window.api`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { OllamaAdapter } from "@ai-orchestrator/shared";
import { Orchestrator, checkHealth } from "@ai-orchestrator/orchestrator";
import { AgenticTeamEngine } from "@ai-orchestrator/agentic-team";

let orchestrator: Orchestrator | null = null;
let agenticTeam: AgenticTeamEngine | null = null;

async function getOrchestrator(): Promise<Orchestrator> {
  if (!orchestrator) {
    orchestrator = new Orchestrator();
    await orchestrator.initialize();
  }
  return orchestrator;
}

async function getAgenticTeam(): Promise<AgenticTeamEngine> {
  if (!agenticTeam) {
    agenticTeam = new AgenticTeamEngine();
    await agenticTeam.reload();
  }
  return agenticTeam;
}

function ollamaProbe(endpoint?: string): OllamaAdapter {
  return new OllamaAdapter({ name: "ollama-probe", endpoint: endpoint ?? "http://localhost:11434" });
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ── Orchestrator ──────────────────────────────────────────────────────
  ipcMain.handle("orchestrator:init", async () => {
    const orch = await getOrchestrator();
    return {
      agents: orch.getAvailableAgents(),
      workflows: orch.getWorkflows(),
      offlineMode: orch.isOfflineMode,
    };
  });

  ipcMain.handle(
    "orchestrator:run",
    async (_event, payload: { task: string; workflow?: string; maxIterations?: number }) => {
      const orch = await getOrchestrator();
      return orch.executeTask(payload.task, payload.workflow ?? "default", payload.maxIterations, (step, iteration) => {
        mainWindow.webContents.send("orchestrator:step", { iteration, ...step });
      });
    },
  );

  ipcMain.handle("orchestrator:health", async () => {
    const orch = await getOrchestrator();
    return checkHealth(orch.adapters, orch.isOfflineMode);
  });

  ipcMain.handle("orchestrator:reload", async () => {
    orchestrator = new Orchestrator();
    await orchestrator.initialize();
    return { agents: orchestrator.getAvailableAgents(), workflows: orchestrator.getWorkflows() };
  });

  // ── Agentic Team ──────────────────────────────────────────────────────
  ipcMain.handle("agentic-team:init", async () => {
    const engine = await getAgenticTeam();
    return {
      agents: engine.getAvailableAgents(),
      teamConfig: engine.getTeamConfig(),
      validation: engine.validateTeamBindings(),
    };
  });

  ipcMain.handle("agentic-team:run", async (_event, payload: { task: string; maxTurns?: number }) => {
    const engine = await getAgenticTeam();
    return engine.executeTask(payload.task, payload.maxTurns, (step) => {
      mainWindow.webContents.send("agentic-team:turn", step);
    });
  });

  ipcMain.handle("agentic-team:validate", async () => {
    const engine = await getAgenticTeam();
    return engine.validateTeamBindings();
  });

  ipcMain.handle("agentic-team:reload", async () => {
    agenticTeam = new AgenticTeamEngine();
    await agenticTeam.reload();
    return { agents: agenticTeam.getAvailableAgents(), teamConfig: agenticTeam.getTeamConfig() };
  });

  // ── Local LLMs (Ollama) — first-class, no cloud CLI required ─────────────
  ipcMain.handle("ollama:health", async (_event, endpoint?: string) => {
    return ollamaProbe(endpoint).healthCheck();
  });

  ipcMain.handle("ollama:list-models", async (_event, endpoint?: string) => {
    return ollamaProbe(endpoint).listModels();
  });

  ipcMain.handle("ollama:pull-model", async (_event, payload: { model: string; endpoint?: string }) => {
    return ollamaProbe(payload.endpoint).pullModel(payload.model);
  });

  ipcMain.handle("ollama:remove-model", async (_event, payload: { model: string; endpoint?: string }) => {
    return ollamaProbe(payload.endpoint).removeModel(payload.model);
  });
}
