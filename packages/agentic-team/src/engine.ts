/** Standalone agentic-team engine with free inter-role communication. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  getLogger,
  loadYamlConfig,
  ClaudeAdapter,
  CodexAdapter,
  GeminiAdapter,
  CopilotAdapter,
  OllamaAdapter,
  LlamaCppAdapter,
  FallbackManager,
  OfflineDetector,
  type AgentConfig,
  type BaseAdapter,
  type Logger,
} from "@ai-orchestrator/shared";
import { MemoryManager, generateProjectId } from "@ai-orchestrator/context-graph";
import { resolveTeamConfig, validateTeamBindings, type RoleSpec, type TeamConfig, type TeamValidationResult } from "./configUtils.js";
import { DEFAULT_MAX_MESSAGE_CHARS, DEFAULT_REPEAT_ROUTE_LIMIT, DEFAULT_TEAM_MAX_TURNS, MAX_TASK_LENGTH } from "./constants.js";
import { DecisionParser } from "./decisionParser.js";
import { buildTeamPrompt } from "./prompts/teamPrompts.js";

type AdapterClass = new (config: AgentConfig) => BaseAdapter;

const CLI_ADAPTER_CLASSES: Record<string, AdapterClass> = {
  codex: CodexAdapter,
  gemini: GeminiAdapter,
  claude: ClaudeAdapter,
  copilot: CopilotAdapter,
};
const CLI_COMMAND_ALIASES: Record<string, string> = {
  "gemini-cli": "gemini",
  "github-copilot-cli": "copilot",
  "gh-copilot": "copilot",
};
const TYPE_ADAPTER_CLASSES: Record<string, AdapterClass> = {
  ollama: OllamaAdapter,
  llamacpp: LlamaCppAdapter,
  localai: LlamaCppAdapter,
  "text-generation-webui": LlamaCppAdapter,
  "openai-compatible": LlamaCppAdapter,
};
const LOCAL_AGENT_TYPES = new Set(["ollama", "llamacpp", "localai", "text-generation-webui", "openai-compatible"]);

export interface AgentDefinition {
  type?: string;
  provider?: string;
  adapter?: string;
  enabled?: boolean;
  command?: string;
  endpoint?: string;
  offline?: boolean;
  [key: string]: unknown;
}

export interface RootConfig {
  agents?: Record<string, AgentDefinition>;
  settings?: {
    output_dir?: string;
    project_path?: string;
    offline?: { enabled?: boolean; auto_detect?: boolean };
    fallback?: { enabled?: boolean; map?: Record<string, string> };
    agentic_team?: { max_message_chars?: number; repeat_route_limit?: number };
    [key: string]: unknown;
  };
  agentic_team?: { lead_role?: string; max_turns?: number; roles?: Record<string, RoleSpec | string> };
}

export interface TeamStep {
  timestamp: string;
  execution_id: string;
  turn: number;
  task: "team_message";
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
  files_modified: string[];
  suggestions: string[];
  communication_type: "to_user" | "self" | "inter_role";
  fallback_from?: string;
}

export interface TeamExecutionResult {
  task: string;
  engine: "agentic_team";
  execution_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  termination_reason: string;
  iterations: [{ steps: TeamStep[]; final_output: string | null }];
  final_output: string;
  success: boolean;
  offline_mode: boolean;
  stats: { turns_executed: number; fallback_count: number; lead_escalation_count: number };
  team: { lead_role: string; max_turns: number; roles: Record<string, RoleSpec> };
}

export interface AgenticTeamEngineOptions {
  configPath?: string;
  forceOffline?: boolean;
  offlineDetector?: OfflineDetector;
}

export class AgenticTeamEngine {
  private readonly logger: Logger = getLogger("agentic_team");
  private readonly forceOffline: boolean;
  private readonly offlineDetector: OfflineDetector;
  private readonly decisionParser = new DecisionParser();
  private readonly configPath: string;

  config: RootConfig = {};
  isOfflineMode = false;
  adapters: Record<string, BaseAdapter> = {};
  fallbackManager: FallbackManager;
  private contextManagerReady = false;

  constructor(options: AgenticTeamEngineOptions = {}) {
    this.forceOffline = options.forceOffline ?? false;
    this.offlineDetector = options.offlineDetector ?? new OfflineDetector();
    this.configPath = options.configPath ?? defaultConfigPath();
    this.fallbackManager = new FallbackManager({}, this.logger);
  }

  /** Load config, resolve offline mode, probe adapters, and register the project. Call before use. */
  async reload(): Promise<void> {
    this.config = this.loadConfig(this.configPath);
    this.isOfflineMode = await this.resolveOfflineMode();
    this.adapters = {};
    this.fallbackManager = new FallbackManager(this.config, this.logger);
    await this.initializeAdapters();
    await this.initContextManager();
  }

  private loadConfig(configPath: string): RootConfig {
    if (!existsSync(configPath)) {
      this.logger.warning(`Config not found: ${configPath}`);
      return {};
    }
    try {
      return loadYamlConfig<RootConfig>(configPath) ?? {};
    } catch (e) {
      this.logger.error(`Failed to load config ${configPath}: ${e}`);
      return {};
    }
  }

  private async resolveOfflineMode(): Promise<boolean> {
    if (this.forceOffline) return true;
    const offlineSettings = this.config.settings?.offline;
    if (offlineSettings) {
      if (offlineSettings.enabled) return true;
      if (offlineSettings.auto_detect) return this.offlineDetector.isOffline();
    }
    return false;
  }

  private resolveAdapterClass(agentName: string, agentConfig: AgentDefinition): AdapterClass | undefined {
    const agentType = String(agentConfig.type ?? "").trim().toLowerCase();
    if (agentType) {
      if (agentType === "cli") {
        const provider = String(agentConfig.provider ?? agentConfig.adapter ?? agentName ?? "").trim().toLowerCase();
        if (provider in CLI_ADAPTER_CLASSES) return CLI_ADAPTER_CLASSES[provider];
        let commandName = String(agentConfig.command ?? "").trim().toLowerCase();
        commandName = commandName.split("/").pop() ?? commandName;
        commandName = CLI_COMMAND_ALIASES[commandName] ?? commandName;
        return CLI_ADAPTER_CLASSES[commandName];
      }
      return TYPE_ADAPTER_CLASSES[agentType];
    }
    return CLI_ADAPTER_CLASSES[agentName];
  }

  private isLocalAgent(agentConfig: AgentDefinition): boolean {
    const agentType = String(agentConfig.type ?? "").trim().toLowerCase();
    return Boolean(agentConfig.offline) || LOCAL_AGENT_TYPES.has(agentType);
  }

  private async initializeAdapters(): Promise<void> {
    const agents = this.config.agents ?? {};
    for (const [agentName, agentConfig] of Object.entries(agents)) {
      if (agentConfig.enabled === false) continue;
      if (this.isOfflineMode && !this.isLocalAgent(agentConfig)) continue;

      const AdapterClass = this.resolveAdapterClass(agentName, agentConfig);
      if (!AdapterClass) continue;

      const runtimeConfig: AgentConfig = { ...agentConfig, name: agentName };
      try {
        const adapter = new AdapterClass(runtimeConfig);
        if (await adapter.checkAvailability()) this.adapters[agentName] = adapter;
      } catch (e) {
        this.logger.error(`Failed to initialize agent ${agentName}: ${e}`);
      }
    }
  }

  private pickPreferredAgent(preferredAgents: string[]): string | undefined {
    const configuredEnabled = Object.entries(this.config.agents ?? {})
      .filter(([, cfg]) => cfg.enabled !== false)
      .map(([name]) => name);

    for (const name of preferredAgents) if (name in this.adapters) return name;
    for (const name of preferredAgents) if (configuredEnabled.includes(name)) return name;
    const first = Object.keys(this.adapters)[0];
    if (first) return first;
    return configuredEnabled[0];
  }

  private runtimeSettings(): { maxMessageChars: number; repeatRouteLimit: number } {
    const raw = this.config.settings?.agentic_team ?? {};
    const positive = (value: unknown, fallback: number, minimum = 1): number => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(minimum, Math.trunc(n)) : fallback;
    };
    return {
      maxMessageChars: positive(raw.max_message_chars ?? DEFAULT_MAX_MESSAGE_CHARS, DEFAULT_MAX_MESSAGE_CHARS, 256),
      repeatRouteLimit: positive(raw.repeat_route_limit ?? DEFAULT_REPEAT_ROUTE_LIMIT, DEFAULT_REPEAT_ROUTE_LIMIT, 2),
    };
  }

  getTeamConfig(): TeamConfig {
    return resolveTeamConfig(this.config.agentic_team, (preferred) => this.pickPreferredAgent(preferred));
  }

  validateTeamBindings(): TeamValidationResult {
    return validateTeamBindings(this.getTeamConfig(), this.getAvailableAgents());
  }

  private assertValidTeamConfig(teamCfg: TeamConfig): void {
    const payload = validateTeamBindings(teamCfg, this.getAvailableAgents());
    if (payload.valid) return;

    if (payload.reason === "invalid_mappings") {
      const missing = payload.missing_roles.map((r) => `${r.role}:${r.agent}`).join(", ");
      throw new Error(`Agentic team roles mapped to unavailable agents: ${missing}`);
    }
    if (payload.reason === "no_available_agents") {
      throw new Error("No available agents detected for agentic team execution");
    }
    throw new Error(payload.error ?? "Invalid agentic team configuration");
  }

  async executeTask(
    rawTask: string,
    maxTurnsOverride?: number,
    onTurn?: (step: TeamStep) => void,
  ): Promise<TeamExecutionResult> {
    if (!rawTask?.trim()) throw new Error("Task is required");
    const task = rawTask.trim();
    if (task.length > MAX_TASK_LENGTH) throw new Error(`Task exceeds maximum length of ${MAX_TASK_LENGTH} characters`);

    const executionId = randomUUID();
    const startedAt = new Date();
    const { maxMessageChars, repeatRouteLimit } = this.runtimeSettings();

    const teamCfg = this.getTeamConfig();
    this.assertValidTeamConfig(teamCfg);

    const roles = teamCfg.roles;
    const leadRole = teamCfg.lead_role;
    const maxTurnsEffective = Math.max(1, maxTurnsOverride ?? teamCfg.max_turns ?? DEFAULT_TEAM_MAX_TURNS);

    const steps: TeamStep[] = [];
    let currentRole = leadRole;
    let senderRole = "user";
    let incomingMessage = task;
    let finalOutput = "";
    let success = false;
    let terminationReason = "max_turns_reached_without_finalize";

    let fallbackCount = 0;
    let leadEscalationCount = 0;
    const repeatedRouteCounts = new Map<string, number>();

    for (let turn = 1; turn <= maxTurnsEffective; turn++) {
      if (!(currentRole in roles)) {
        this.logger.warning(`Role '${currentRole}' not found in team config, falling back to lead`);
        currentRole = leadRole;
      }
      const roleSpec = roles[currentRole] as RoleSpec;

      const prompt = buildTeamPrompt({
        roleName: currentRole,
        roleSpec,
        leadRole,
        originalTask: task,
        senderRole,
        incomingMessage,
        transcript: steps,
        teamRoles: roles,
        turn,
        maxTurns: maxTurnsEffective,
      });

      const configuredDir = this.config.settings?.output_dir ?? "./output";
      const workingDir = existsSync(configuredDir) ? configuredDir : process.cwd();

      const turnContext: Record<string, unknown> = {
        role: "team_member",
        team_role: currentRole,
        lead_role: leadRole,
        sender_role: senderRole,
        incoming_message: incomingMessage,
        working_dir: workingDir,
        offline_mode: this.isOfflineMode,
        execution_id: executionId,
      };

      const primaryAgent = String(roleSpec.agent ?? "");
      const { agentUsed, response, fallbackFrom } = await this.fallbackManager.executeWithFallback({
        primaryAgent,
        adapters: this.adapters,
        task: prompt,
        context: turnContext,
        explicitFallback: roleSpec.fallback,
      });
      if (fallbackFrom) fallbackCount += 1;

      const decision = this.decisionParser.parseDecision({
        output: response.output,
        currentRole,
        leadRole,
        defaultToRole: leadRole,
      });
      let action = decision.action || "message";
      let toRole = decision.to_role || leadRole;
      let message = decision.message ?? "";

      if (message.length > maxMessageChars) {
        message = `${message.slice(0, maxMessageChars - 64).trimEnd()}\n\n[System] Message truncated due to max_message_chars policy.`;
      }

      if (!response.success) {
        action = "message";
        toRole = leadRole;
        message = `Execution failed for role '${currentRole}': ${response.error ?? "unknown error"}`;
      }

      if (!(toRole in roles) && toRole !== "user") toRole = leadRole;

      const routeFingerprint = `${currentRole}->${toRole}:${message.trim().toLowerCase().slice(0, 240)}`;
      const repeatCount = (repeatedRouteCounts.get(routeFingerprint) ?? 0) + 1;
      repeatedRouteCounts.set(routeFingerprint, repeatCount);
      if (action === "message" && currentRole !== leadRole && repeatCount >= repeatRouteLimit) {
        toRole = leadRole;
        message = `${message}\n\n[System] Repetition detected in team routing. Escalating to lead for decision.`.trim();
        leadEscalationCount += 1;
      }

      if (action === "finalize" && currentRole === leadRole) {
        finalOutput = String(decision.final_response || response.output || "").trim();
        success = response.success;
        toRole = "user";
        terminationReason = "lead_finalize";
      }

      const step: TeamStep = {
        timestamp: new Date().toISOString(),
        execution_id: executionId,
        turn,
        task: "team_message",
        action,
        agent: agentUsed,
        from_agent: agentUsed,
        team_role: currentRole,
        from_role: currentRole,
        to_role: toRole,
        to_agent: toRole in roles ? String(roles[toRole]?.agent ?? "") : toRole === "user" ? "user" : "",
        message,
        success: response.success,
        output: response.output,
        error: response.error,
        files_modified: response.filesModified,
        suggestions: response.suggestions,
        communication_type: toRole === "user" ? "to_user" : toRole === currentRole ? "self" : "inter_role",
      };
      if (fallbackFrom) step.fallback_from = fallbackFrom;

      steps.push(step);
      this.storeTurnInContext(step);
      if (onTurn) {
        try {
          onTurn({ ...step });
        } catch (e) {
          this.logger.warning(`Agentic team turn callback failed: ${e}`);
        }
      }

      if (action === "finalize" && currentRole === leadRole) break;

      senderRole = currentRole;
      incomingMessage = message;
      currentRole = toRole in roles ? toRole : leadRole;
    }

    if (!finalOutput) {
      const fallbackOutput = steps.length ? steps[steps.length - 1]?.output ?? "" : "";
      finalOutput = `Team reached max turns without lead finalization. Last output:\n\n${fallbackOutput}`;
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const result: TeamExecutionResult = {
      task,
      engine: "agentic_team",
      execution_id: executionId,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      termination_reason: terminationReason,
      iterations: [{ steps, final_output: finalOutput }],
      final_output: finalOutput,
      success,
      offline_mode: this.isOfflineMode,
      stats: { turns_executed: steps.length, fallback_count: fallbackCount, lead_escalation_count: leadEscalationCount },
      team: { lead_role: leadRole, max_turns: maxTurnsEffective, roles },
    };

    this.storeTaskInContext(task, result, durationMs / 1000);

    return result;
  }

  getAvailableAgents(): string[] {
    return Object.keys(this.adapters).sort();
  }

  getRuntimeStatus(): Record<string, unknown> {
    return {
      engine: "agentic_team",
      config_path: this.configPath,
      offline_mode: this.isOfflineMode,
      available_agents: this.getAvailableAgents(),
      team_validation: this.validateTeamBindings(),
      runtime_settings: this.runtimeSettings(),
    };
  }

  private contextDbPath(): string {
    return process.env.AGENTIC_TEAM_CONTEXT_DB ?? join(homedir(), ".agentic-team", "context.db");
  }

  private async initContextManager(): Promise<void> {
    try {
      const projectPath = (process.env.PROJECT_PATH ?? this.config.settings?.project_path ?? "").trim();
      if (projectPath && existsSync(projectPath)) {
        const manager = new MemoryManager(this.contextDbPath());
        try {
          manager.registerProject(projectPath);
        } finally {
          manager.close();
        }
      }
      this.contextManagerReady = true;
      this.logger.info("Context manager initialized for agentic team");
    } catch (e) {
      this.logger.warning(`Failed to initialize context manager: ${e}`);
    }
  }

  private resolveProjectId(): string {
    const projectPath = (process.env.PROJECT_PATH ?? this.config.settings?.project_path ?? "").trim();
    if (!projectPath || !existsSync(projectPath)) return "";
    try {
      return generateProjectId(projectPath);
    } catch {
      return "";
    }
  }

  private storeTaskInContext(task: string, result: TeamExecutionResult, durationSeconds: number): void {
    if (!this.contextManagerReady) return;
    try {
      const manager = new MemoryManager(this.contextDbPath());
      try {
        const rolesUsed = Object.keys(result.team.roles).sort();
        let communications = 0;
        for (const iteration of result.iterations) {
          for (const step of iteration.steps) if (step.communication_type === "inter_role") communications += 1;
        }

        manager.storeTask({
          taskDescription: task,
          outcome: result.success ? "completed" : "failed",
          success: result.success,
          durationMs: Math.round(durationSeconds * 1000),
          agentsInvolved: rolesUsed,
          tags: ["agentic_team"],
          projectId: this.resolveProjectId(),
        });

        if (!result.success && result.final_output) {
          manager.storeMistake({
            errorType: "task_failure",
            errorMessage: `Task failed: ${task.slice(0, 100)}`,
            contextDescription: result.final_output.slice(0, 500),
            correction: "Review team execution steps for improvement",
          });
        }
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.warning(`Failed to store task in context: ${e}`);
    }
  }

  private storeTurnInContext(step: TeamStep): void {
    if (!this.contextManagerReady) return;
    try {
      const manager = new MemoryManager(this.contextDbPath());
      try {
        manager.storeTask({
          taskDescription: `[turn ${step.turn}] ${step.from_role} -> ${step.to_role}`,
          outcome: step.output.slice(0, 2000),
          success: step.success,
          durationMs: 0,
          tags: ["agentic_team", "turn", step.execution_id],
        });
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.debug(`Failed to store turn in context: ${e}`);
    }
  }

  getRelevantContext(query: string, limit = 5): Array<Record<string, unknown>> {
    try {
      const manager = new MemoryManager(this.contextDbPath());
      try {
        return manager.search(query, { limit }).map((r) => ({
          node_id: r.node.id,
          type: r.node.nodeType,
          content: r.node.content,
          score: r.score,
          metadata: r.node.metadata,
        }));
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.warning(`Failed to retrieve context: ${e}`);
      return [];
    }
  }
}

function defaultConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config", "agents.yaml");
}
