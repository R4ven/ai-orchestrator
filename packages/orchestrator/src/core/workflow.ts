/** Workflow management for AI agent orchestration. */
import { getLogger, type AgentResponse, type BaseAdapter, makeResponse } from "@ai-orchestrator/shared";

export interface WorkflowStepConfig {
  agent?: string;
  task?: string;
  role?: string;
  description?: string;
  fallback?: string;
  [key: string]: unknown;
}

export class WorkflowStep {
  constructor(
    readonly agentName: string,
    readonly taskType: string,
    readonly adapter: BaseAdapter,
    readonly config: WorkflowStepConfig,
  ) {}

  async execute(context: Record<string, unknown>): Promise<AgentResponse> {
    const task = this.buildTaskDescription(context);
    const stepContext = this.buildStepContext(context);
    return this.adapter.executeTask(task, stepContext);
  }

  async executeWithAdapter(adapter: BaseAdapter, context: Record<string, unknown>): Promise<AgentResponse> {
    const task = this.buildTaskDescription(context);
    const stepContext = this.buildStepContext(context);
    return adapter.executeTask(task, stepContext);
  }

  buildStepContext(context: Record<string, unknown>): Record<string, unknown> {
    return { ...context, role: this.taskType, agent: this.agentName };
  }

  buildTaskDescription(context: Record<string, unknown>): string {
    const baseTask = (context.task as string) ?? "";
    switch (this.taskType) {
      case "implement":
        return `Implement the following: ${baseTask}`;
      case "review":
        return `Review the implementation of: ${baseTask}`;
      case "refine":
        return `Refine the implementation based on review feedback for: ${baseTask}`;
      case "test":
        return `Write tests for: ${baseTask}`;
      case "document":
        return `Document the implementation of: ${baseTask}`;
      default:
        return baseTask;
    }
  }
}

export class WorkflowEngine {
  private readonly logger = getLogger("workflow_engine");
  steps: WorkflowStep[] = [];
  currentStep = 0;

  setWorkflow(steps: WorkflowStep[]): void {
    this.steps = steps;
    this.currentStep = 0;
    this.logger.info(`Workflow configured with ${steps.length} steps`);
  }

  async execute(context: Record<string, unknown>): Promise<AgentResponse[]> {
    const results: AgentResponse[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      this.currentStep = i;
      const step = this.steps[i] as WorkflowStep;
      this.logger.info(`Executing step ${i + 1}/${this.steps.length}: ${step.agentName}`);

      try {
        const response = await step.execute(context);
        results.push(response);
        context.previous_response = response;
        context.previous_output = response.output;
      } catch (e) {
        this.logger.error(`Step ${i + 1} failed: ${e}`);
        results.push(makeResponse({ success: false, output: "", error: String(e) }));
      }
    }

    return results;
  }

  getProgress(): { currentStep: number; totalSteps: number; progressPercent: number } {
    const total = this.steps.length;
    return {
      currentStep: this.currentStep,
      totalSteps: total,
      progressPercent: total > 0 ? (this.currentStep / total) * 100 : 0,
    };
  }
}
