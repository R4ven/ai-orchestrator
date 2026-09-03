/** Preload script: the only bridge between the sandboxed renderer and Node/Electron APIs. */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function subscribe<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: T): void => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  orchestrator: {
    init: () => ipcRenderer.invoke("orchestrator:init"),
    run: (payload: { task: string; workflow?: string; maxIterations?: number }) =>
      ipcRenderer.invoke("orchestrator:run", payload),
    health: () => ipcRenderer.invoke("orchestrator:health"),
    reload: () => ipcRenderer.invoke("orchestrator:reload"),
    onStep: subscribe<Record<string, unknown>>("orchestrator:step"),
  },
  agenticTeam: {
    init: () => ipcRenderer.invoke("agentic-team:init"),
    run: (payload: { task: string; maxTurns?: number }) => ipcRenderer.invoke("agentic-team:run", payload),
    validate: () => ipcRenderer.invoke("agentic-team:validate"),
    reload: () => ipcRenderer.invoke("agentic-team:reload"),
    onTurn: subscribe<Record<string, unknown>>("agentic-team:turn"),
  },
  ollama: {
    health: (endpoint?: string) => ipcRenderer.invoke("ollama:health", endpoint),
    listModels: (endpoint?: string) => ipcRenderer.invoke("ollama:list-models", endpoint),
    pullModel: (model: string, endpoint?: string) => ipcRenderer.invoke("ollama:pull-model", { model, endpoint }),
    removeModel: (model: string, endpoint?: string) => ipcRenderer.invoke("ollama:remove-model", { model, endpoint }),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
