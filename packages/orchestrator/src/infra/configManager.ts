/** Configuration loading, defaults, and validation for the orchestrator. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getLogger, loadYamlConfig } from "@ai-orchestrator/shared";

const logger = getLogger("orchestrator.config");

export interface AgentDefinition {
  type?: string;
  provider?: string;
  adapter?: string;
  enabled?: boolean;
  command?: string;
  endpoint?: string;
  role?: string;
  timeout?: number;
  description?: string;
  offline?: boolean;
  model?: string;
  capabilities?: string[];
  [key: string]: unknown;
}

export interface WorkflowStepDefinition {
  agent?: string;
  task?: string;
  role?: string;
  description?: string;
  fallback?: string;
  [key: string]: unknown;
}

export type WorkflowDefinition = WorkflowStepDefinition[] | { description?: string; offline?: boolean; steps: WorkflowStepDefinition[] };

export interface OrchestratorSettings {
  max_iterations?: number;
  output_dir?: string;
  workspace_dir?: string;
  log_level?: string;
  log_file?: string;
  create_reports?: boolean;
  reports_dir?: string;
  min_suggestions_threshold?: number;
  colored_output?: boolean;
  project_path?: string;
  enable_context_memory?: boolean;
  offline?: { enabled?: boolean; auto_detect?: boolean };
  fallback?: { enabled?: boolean; map?: Record<string, string> };
  [key: string]: unknown;
}

export interface RoleDefinition {
  title?: string;
  agent?: string;
  responsibilities?: string;
}

export interface AgenticTeamConfig {
  lead_role?: string;
  max_turns?: number;
  roles?: Record<string, RoleDefinition>;
}

export interface OrchestratorConfig {
  agents: Record<string, AgentDefinition>;
  workflows: Record<string, WorkflowDefinition>;
  settings: OrchestratorSettings;
  agentic_team?: AgenticTeamConfig;
}

export function getDefaultConfig(): OrchestratorConfig {
  return {
    agents: {
      codex: { type: "cli", enabled: true, command: "codex", role: "implementation", timeout: 3600 },
      gemini: { type: "cli", enabled: true, command: "gemini-cli", role: "review", timeout: 3600 },
      claude: { type: "cli", enabled: true, command: "claude", role: "refinement", timeout: 3600 },
      copilot: { type: "cli", enabled: false, command: "github-copilot-cli", role: "suggestions", timeout: 3600 },
      "local-code": {
        type: "ollama",
        enabled: false,
        model: "codellama:13b",
        endpoint: "http://localhost:11434",
        offline: true,
        timeout: 3600,
      },
      "local-instruct": {
        type: "ollama",
        enabled: false,
        model: "mistral:7b-instruct",
        endpoint: "http://localhost:11434",
        offline: true,
        timeout: 3600,
      },
      "local-large": { type: "llamacpp", enabled: false, endpoint: "http://localhost:8080", offline: true, timeout: 3600 },
    },
    workflows: {
      default: [
        { agent: "codex", task: "implement" },
        { agent: "gemini", task: "review" },
        { agent: "claude", task: "refine" },
      ],
      "offline-default": [
        { agent: "local-code", task: "implement" },
        { agent: "local-instruct", task: "review" },
      ],
    },
    settings: {
      max_iterations: 3,
      output_dir: "./output",
      log_level: "INFO",
      offline: { enabled: false, auto_detect: true },
      fallback: { enabled: false, map: { claude: "local-instruct", codex: "local-code" } },
    },
  };
}

export function resolveDefaultConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config", "agents.yaml");
}

export function loadOrchestratorConfig(configPath?: string): OrchestratorConfig {
  const path = configPath ?? resolveDefaultConfigPath();

  if (!existsSync(path)) {
    logger.warning(`Config file not found: ${path}, using defaults`);
    return getDefaultConfig();
  }

  const loaded = loadYamlConfig<Partial<OrchestratorConfig>>(path);
  if (!loaded) return getDefaultConfig();

  return {
    agents: loaded.agents ?? {},
    workflows: loaded.workflows ?? {},
    settings: loaded.settings ?? {},
    agentic_team: loaded.agentic_team,
  };
}

/** Basic structural validation, surfaced by the `validate` CLI command. */
export function validateConfig(config: OrchestratorConfig): string[] {
  const problems: string[] = [];

  if (!config.agents || Object.keys(config.agents).length === 0) {
    problems.push("No agents defined in configuration.");
  }
  if (!config.workflows || Object.keys(config.workflows).length === 0) {
    problems.push("No workflows defined in configuration.");
  }

  for (const [workflowName, workflow] of Object.entries(config.workflows ?? {})) {
    const steps = Array.isArray(workflow) ? workflow : workflow.steps;
    if (!steps?.length) {
      problems.push(`Workflow '${workflowName}' has no steps.`);
      continue;
    }
    for (const step of steps) {
      if (step.agent && !(step.agent in (config.agents ?? {}))) {
        problems.push(`Workflow '${workflowName}' references unknown agent '${step.agent}'.`);
      }
    }
  }

  const fallbackMap = config.settings?.fallback?.map ?? {};
  for (const [from, to] of Object.entries(fallbackMap)) {
    if (!(from in (config.agents ?? {}))) problems.push(`Fallback map references unknown source agent '${from}'.`);
    if (!(to in (config.agents ?? {}))) problems.push(`Fallback map references unknown target agent '${to}'.`);
  }

  return problems;
}
