/** Renderer-side typing for the API the preload script exposes via contextBridge. */

export interface OrchestratorInitResult {
  agents: string[];
  workflows: string[];
  offlineMode: boolean;
}

export interface AgentResponseLike {
  agent: string;
  task: string;
  success: boolean;
  output: string;
  error?: string | null;
  files_modified: string[];
  suggestions: string[];
  fallback_from?: string;
}

export interface OrchestratorStepEvent extends AgentResponseLike {
  iteration: number;
}

export interface OrchestratorRunResult {
  task: string;
  workflow: string;
  iterations: Array<{ steps: AgentResponseLike[]; final_output: string | null }>;
  final_output: unknown;
  success: boolean;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  agents: Record<string, { available: boolean }>;
  offlineMode: boolean;
}

export interface RoleSpec {
  title?: string;
  agent?: string | null;
  responsibilities?: string;
  fallback?: string;
}

export interface TeamConfig {
  lead_role: string;
  max_turns: number;
  roles: Record<string, RoleSpec>;
}

export interface TeamValidationResult {
  valid: boolean;
  available_agents: string[];
  missing_roles: Array<{ role: string; agent?: string | null }>;
  reason: string;
  error?: string;
}

export interface AgenticTeamInitResult {
  agents: string[];
  teamConfig: TeamConfig;
  validation: TeamValidationResult;
}

export interface TeamStepEvent {
  turn: number;
  action: string;
  agent: string;
  from_agent: string;
  team_role: string;
  from_role: string;
  to_role: string;
  to_agent: string;
  message: string;
  success: boolean;
  output: string;
  error?: string | null;
  communication_type: "to_user" | "self" | "inter_role";
  fallback_from?: string;
}

export interface AgenticTeamRunResult {
  task: string;
  final_output: string;
  success: boolean;
  termination_reason: string;
  stats: { turns_executed: number; fallback_count: number; lead_escalation_count: number };
  team: { lead_role: string; max_turns: number; roles: Record<string, RoleSpec> };
}

export interface AgentResponseSimple {
  success: boolean;
  output: string;
  error?: string;
}

export interface Api {
  orchestrator: {
    init(): Promise<OrchestratorInitResult>;
    run(payload: { task: string; workflow?: string; maxIterations?: number }): Promise<OrchestratorRunResult>;
    health(): Promise<HealthStatus>;
    reload(): Promise<{ agents: string[]; workflows: string[] }>;
    onStep(callback: (data: OrchestratorStepEvent) => void): () => void;
  };
  agenticTeam: {
    init(): Promise<AgenticTeamInitResult>;
    run(payload: { task: string; maxTurns?: number }): Promise<AgenticTeamRunResult>;
    validate(): Promise<TeamValidationResult>;
    reload(): Promise<{ agents: string[]; teamConfig: TeamConfig }>;
    onTurn(callback: (data: TeamStepEvent) => void): () => void;
  };
  ollama: {
    health(endpoint?: string): Promise<boolean>;
    listModels(endpoint?: string): Promise<string[]>;
    pullModel(model: string, endpoint?: string): Promise<AgentResponseSimple>;
    removeModel(model: string, endpoint?: string): Promise<AgentResponseSimple>;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
