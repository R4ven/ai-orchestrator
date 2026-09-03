/** Core orchestration logic for coordinating AI agents. */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  getLogger,
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
} from "@ai-orchestrator/shared";
import { MemoryManager, generateProjectId } from "@ai-orchestrator/context-graph";
import { WorkflowEngine, WorkflowStep, type WorkflowStepConfig } from "./workflow.js";
import { TaskManager } from "./taskManager.js";
import { PlannerAgent } from "./planner.js";
import {
  loadOrchestratorConfig,
  type OrchestratorConfig,
  type AgentDefinition,
  type WorkflowDefinition,
} from "../infra/configManager.js";
import {
  ReportGenerator,
  type ExecutionResults,
  type IterationResult,
  type IterationStepResult,
} from "../observability/reportGenerator.js";
import { getMetricsCollector } from "../observability/metrics.js";

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

export interface OrchestratorOptions {
  configPath?: string;
  forceOffline?: boolean;
  offlineDetector?: OfflineDetector;
}

export class Orchestrator {
  private readonly logger = getLogger("orchestrator");
  readonly config: OrchestratorConfig;
  private readonly forceOffline: boolean;
  private readonly offlineDetector: OfflineDetector;
  readonly adapters: Record<string, BaseAdapter> = {};
  readonly workflowEngine = new WorkflowEngine();
  readonly taskManager = new TaskManager();
  readonly fallbackManager: FallbackManager;
  isOfflineMode = false;
  private readonly metrics = getMetricsCollector();
  private initialized = false;

  constructor(options: OrchestratorOptions = {}) {
    this.config = loadOrchestratorConfig(options.configPath);
    this.forceOffline = options.forceOffline ?? false;
    this.offlineDetector = options.offlineDetector ?? new OfflineDetector();
    this.fallbackManager = new FallbackManager(this.config, this.logger);
  }

  /** Async initialization: resolves offline mode, probes adapters, registers the project. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.isOfflineMode = await this.resolveOfflineMode();
    await this.initializeAdapters();
    this.maybeRegisterProject();
    this.initialized = true;
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
    const agentsConfig = this.config.agents ?? {};

    for (const [agentName, agentConfig] of Object.entries(agentsConfig)) {
      if (agentConfig.enabled === false) {
        this.logger.info(`Agent ${agentName} is disabled`);
        continue;
      }
      if (this.isOfflineMode && !this.isLocalAgent(agentConfig)) {
        this.logger.info(`Skipping non-local agent in offline mode: ${agentName}`);
        continue;
      }

      const AdapterClass = this.resolveAdapterClass(agentName, agentConfig);
      if (!AdapterClass) {
        this.logger.warning(`Unknown agent type for '${agentName}' (type=${agentConfig.type})`);
        continue;
      }

      const runtimeConfig: AgentConfig = { ...agentConfig, name: agentName };

      try {
        const adapter = new AdapterClass(runtimeConfig);
        const available = await adapter.checkAvailability();
        if (!available) {
          if (runtimeConfig.endpoint) {
            this.logger.warning(`Agent ${agentName} is not available. Endpoint '${runtimeConfig.endpoint}' is unreachable.`);
          } else {
            this.logger.warning(`Agent ${agentName} is not available. Command '${adapter.command}' not found.`);
          }
          continue;
        }
        this.adapters[agentName] = adapter;
        this.logger.info(`Initialized adapter: ${agentName}`);
      } catch (e) {
        this.logger.error(`Failed to initialize ${agentName}: ${e}`);
      }
    }

    this.metrics.updateActiveAgents(Object.keys(this.adapters).length);
  }

  async executeTask(task: string, workflowName = "default", maxIterationsOverride?: number): Promise<ExecutionResults> {
    await this.initialize();

    const executionStart = Date.now();
    this.logger.info(`Executing task: ${task}`);
    this.logger.info(`Workflow: ${workflowName}`);

    let workflowStepsConfig: WorkflowStepConfig[];
    if (workflowName === "dynamic") {
      this.logger.info("Using dynamic PlannerAgent to build workflow.");
      workflowStepsConfig = await new PlannerAgent(this.adapters, this.logger).planWorkflow(task);
    } else {
      const workflowConfig = this.config.workflows?.[workflowName];
      if (!workflowConfig) {
        if (workflowName === "default") {
          this.logger.info("Default workflow not found in config. Using dynamic planner.");
          workflowStepsConfig = await new PlannerAgent(this.adapters, this.logger).planWorkflow(task);
        } else {
          throw new Error(`Workflow '${workflowName}' not found`);
        }
      } else {
        workflowStepsConfig = this.extractWorkflowSteps(workflowConfig);
      }
    }

    const steps = this.buildWorkflowSteps(workflowStepsConfig);
    if (!steps.length) {
      throw new Error(`Workflow '${workflowName}' has no executable steps (check agent availability/offline mode).`);
    }
    this.workflowEngine.setWorkflow(steps);

    const maxIterations = maxIterationsOverride ?? this.config.settings?.max_iterations ?? 3;

    const configuredDir = this.config.settings?.output_dir ?? "./output";
    let workingDir = configuredDir;
    if (!existsSync(workingDir)) {
      workingDir = process.cwd();
    }

    const projectId = this.resolveProjectId();

    let context: Record<string, unknown> = {
      task,
      iteration: 0,
      max_iterations: maxIterations,
      working_dir: workingDir,
      offline_mode: this.isOfflineMode,
      project_id: projectId,
    };

    const results: ExecutionResults = {
      task,
      workflow: workflowName,
      iterations: [],
      final_output: null,
      success: false,
    };

    let allSucceeded = false;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      this.logger.info("=".repeat(60));
      this.logger.info(`Iteration ${iteration + 1}/${maxIterations}`);
      this.logger.info("=".repeat(60));

      context.iteration = iteration;

      const iterationResults = await this.executeWorkflowIteration(steps, context);
      results.iterations.push(iterationResults);

      if (this.shouldStopIteration(iterationResults)) {
        this.logger.info("Stopping iterations: task appears complete");
        results.success = true;
        allSucceeded = true;
        break;
      }

      context = this.updateContext(context, iterationResults);
    }

    if (!allSucceeded && results.iterations.length) {
      const lastIter = results.iterations[results.iterations.length - 1] as IterationResult;
      if (lastIter.steps.every((s) => s.success)) results.success = true;
    }

    if (results.iterations.length) {
      const lastIteration = results.iterations[results.iterations.length - 1] as IterationResult;
      results.final_output = lastIteration.final_output;
    }

    this.maybeGenerateReport(task, workflowName, results, executionStart);

    const executionTime = (Date.now() - executionStart) / 1000;
    this.metrics.recordTaskComplete(workflowName, results.success, executionTime);
    this.storeTaskInContext(task, workflowName, results, executionTime);

    return results;
  }

  private extractWorkflowSteps(workflowConfig: WorkflowDefinition): WorkflowStepConfig[] {
    if (Array.isArray(workflowConfig)) return workflowConfig;
    if (workflowConfig && typeof workflowConfig === "object" && Array.isArray(workflowConfig.steps)) {
      return workflowConfig.steps;
    }
    return [];
  }

  private normalizeTaskType(rawTask?: string): string {
    if (!rawTask) return "implement";
    const task = rawTask.trim().toLowerCase();
    const roleMap: Record<string, string> = {
      implementer: "implement",
      reviewer: "review",
      refiner: "refine",
      writer: "document",
      tester: "test",
    };
    return roleMap[task] ?? task;
  }

  private buildWorkflowSteps(workflowConfig: WorkflowStepConfig[]): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    for (const stepConfig of workflowConfig) {
      const agentName = stepConfig.agent;
      const taskType = this.normalizeTaskType(stepConfig.task ?? stepConfig.role);

      if (!agentName || !(agentName in this.adapters)) {
        this.logger.warning(`Agent ${agentName} not available, skipping step`);
        continue;
      }

      steps.push(new WorkflowStep(agentName, taskType, this.adapters[agentName] as BaseAdapter, stepConfig));
    }
    return steps;
  }

  private async executeWorkflowIteration(steps: WorkflowStep[], context: Record<string, unknown>): Promise<IterationResult> {
    const iterationResults: IterationResult = { steps: [], final_output: null };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as WorkflowStep;
      this.logger.info(`Step ${i + 1}: ${step.agentName} - ${step.taskType}`);

      try {
        const task = step.buildTaskDescription(context);
        const stepContext = step.buildStepContext(context);

        const callStart = Date.now();
        const { agentUsed, response, fallbackFrom } = await this.fallbackManager.executeWithFallback({
          primaryAgent: step.agentName,
          adapters: this.adapters,
          task,
          context: stepContext,
          explicitFallback: step.config.fallback,
        });
        this.metrics.recordAgentCall(agentUsed, response.success, (Date.now() - callStart) / 1000, response.error ? "execution_error" : undefined);

        const stepResult: IterationStepResult = {
          agent: agentUsed,
          task: step.taskType,
          success: response.success,
          output: response.output,
          error: response.error,
          files_modified: response.filesModified,
          suggestions: response.suggestions,
        };
        if (fallbackFrom) stepResult.fallback_from = fallbackFrom;
        iterationResults.steps.push(stepResult);

        if (response.success) {
          if (fallbackFrom) {
            this.logger.info(`✓ ${agentUsed} completed successfully via fallback from ${fallbackFrom}`);
          } else {
            this.logger.info(`✓ ${agentUsed} completed successfully`);
          }
          if (response.suggestions.length) this.logger.info(`  Suggestions: ${response.suggestions.length}`);
        } else {
          this.logger.error(`✗ ${agentUsed} failed: ${response.error}`);
        }

        context.previous_output = response.output;
        context.previous_agent = agentUsed;

        if (step.taskType === "review") {
          context.feedback = response.output;
          context.suggestions = response.suggestions;
        } else if (step.taskType === "implement") {
          context.implementation = response.output;
          context.files = response.filesModified;
        }

        iterationResults.final_output = response.output;
      } catch (e) {
        this.logger.error(`Error executing step: ${e}`);
        iterationResults.steps.push({
          agent: step.agentName,
          task: step.taskType,
          success: false,
          output: "",
          error: String(e),
          files_modified: [],
          suggestions: [],
        });
      }
    }

    return iterationResults;
  }

  private shouldStopIteration(iterationResults: IterationResult): boolean {
    const allSuccess = iterationResults.steps.every((s) => s.success);

    let hasMinimalFeedback = true;
    for (const step of iterationResults.steps) {
      if (step.task === "review" && step.suggestions.length > 3) hasMinimalFeedback = false;
    }

    return allSuccess && hasMinimalFeedback;
  }

  private updateContext(context: Record<string, unknown>, iterationResults: IterationResult): Record<string, unknown> {
    const nextContext = { ...context, iteration: (context.iteration as number) + 1 };
    const allIterations = (nextContext.all_iterations as IterationResult[]) ?? [];
    allIterations.push(iterationResults);
    nextContext.all_iterations = allIterations;
    return nextContext;
  }

  private maybeGenerateReport(task: string, workflowName: string, results: ExecutionResults, executionStart: number): void {
    if (!this.config.settings?.create_reports) return;
    try {
      const reportsDir = this.config.settings?.reports_dir ?? "./reports";
      const gen = new ReportGenerator(String(reportsDir));
      gen.generateExecutionReport({
        task,
        workflow: workflowName,
        results,
        durationSeconds: (Date.now() - executionStart) / 1000,
        availableAgents: this.getAvailableAgents(),
      });
    } catch (e) {
      this.logger.warning(`Failed to generate execution report: ${e}`);
    }
  }

  private contextDbPath(): string {
    return process.env.ORCHESTRATOR_CONTEXT_DB ?? join(homedir(), ".ai-orchestrator", "context.db");
  }

  private storeTaskInContext(task: string, workflowName: string, results: ExecutionResults, executionTimeSeconds: number): void {
    if (this.config.settings?.enable_context_memory === false) return;
    try {
      const dbPath = this.contextDbPath();
      const manager = new MemoryManager(dbPath);
      try {
        const agentsInvolved = new Set<string>();
        for (const iteration of results.iterations) {
          for (const step of iteration.steps) {
            if (step.agent) agentsInvolved.add(step.agent);
          }
        }
        manager.storeTask({
          taskDescription: task,
          outcome: String(results.final_output ?? "").slice(0, 5000),
          success: results.success,
          durationMs: Math.round(executionTimeSeconds * 1000),
          workflowUsed: workflowName,
          agentsInvolved: [...agentsInvolved],
          tags: ["orchestrator"],
          projectId: this.resolveProjectId(),
        });
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.debug(`Failed to store task in context: ${e}`);
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

  private maybeRegisterProject(): void {
    const projectPath = (process.env.PROJECT_PATH ?? this.config.settings?.project_path ?? "").trim();
    if (!projectPath || !existsSync(projectPath)) return;

    try {
      const dbPath = this.contextDbPath();
      mkdirSync(dirname(dbPath), { recursive: true });
      const manager = new MemoryManager(dbPath);
      try {
        manager.registerProject(projectPath);
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.debug(`Failed to register project: ${e}`);
    }
  }

  getRelevantContext(taskDescription: string): unknown {
    try {
      const dbPath = this.contextDbPath();
      if (!existsSync(dbPath)) return {};
      const manager = new MemoryManager(dbPath);
      try {
        return manager.getRelevantContext(taskDescription, this.resolveProjectId());
      } finally {
        manager.close();
      }
    } catch (e) {
      this.logger.debug(`Failed to get context: ${e}`);
      return {};
    }
  }

  getAvailableAgents(): string[] {
    return Object.keys(this.adapters);
  }

  getWorkflows(): string[] {
    return Object.keys(this.config.workflows ?? {});
  }
}
