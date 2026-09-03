/** Engine registry: initializes and holds references to both runtimes. */
import { getLogger } from "@ai-orchestrator/shared";
import { Orchestrator } from "@ai-orchestrator/orchestrator";
import { AgenticTeamEngine } from "@ai-orchestrator/agentic-team";

const logger = getLogger("mcp_server.engines");

interface EngineRegistry {
  orchestrator: Orchestrator | null;
  orchestratorError: string | null;
  agenticTeam: AgenticTeamEngine | null;
  agenticTeamError: string | null;
}

const engines: EngineRegistry = {
  orchestrator: null,
  orchestratorError: null,
  agenticTeam: null,
  agenticTeamError: null,
};

export async function initEngines(): Promise<void> {
  await Promise.all([initOrchestrator(), initAgenticTeam()]);
}

async function initOrchestrator(): Promise<void> {
  try {
    const orch = new Orchestrator();
    await orch.initialize();
    engines.orchestrator = orch;
    engines.orchestratorError = null;
    logger.info(`Orchestrator initialised: ${orch.getAvailableAgents().join(", ")}`);
  } catch (exc) {
    engines.orchestrator = null;
    engines.orchestratorError = String(exc);
    logger.error(`Orchestrator init failed: ${exc}`);
  }
}

async function initAgenticTeam(): Promise<void> {
  try {
    const engine = new AgenticTeamEngine();
    await engine.reload();
    engines.agenticTeam = engine;
    engines.agenticTeamError = null;
    logger.info(`Agentic Team initialised: ${engine.getAvailableAgents().join(", ")}`);
  } catch (exc) {
    engines.agenticTeam = null;
    engines.agenticTeamError = String(exc);
    logger.error(`Agentic Team init failed: ${exc}`);
  }
}

export class ToolError extends Error {}

export function getOrchestrator(): Orchestrator {
  if (!engines.orchestrator) {
    throw new ToolError(`orchestrator is not available: ${engines.orchestratorError ?? "not initialised"}`);
  }
  return engines.orchestrator;
}

export function getAgenticTeam(): AgenticTeamEngine {
  if (!engines.agenticTeam) {
    throw new ToolError(`agentic_team is not available: ${engines.agenticTeamError ?? "not initialised"}`);
  }
  return engines.agenticTeam;
}

export function engineStatus(): Record<string, unknown> {
  return {
    orchestrator: engines.orchestrator ? "available" : `unavailable: ${engines.orchestratorError}`,
    agentic_team: engines.agenticTeam ? "available" : `unavailable: ${engines.agenticTeamError}`,
  };
}
