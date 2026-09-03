/** Dynamic workflow planner agent using metrics-based routing. */
import { getLogger, type BaseAdapter, type Logger } from "@ai-orchestrator/shared";
import { getMetricsCollector } from "../observability/metrics.js";
import type { WorkflowStepConfig } from "./workflow.js";

const PLANNER_PREFERENCE = ["claude", "gemini", "codex", "local-instruct", "local-code", "local-large"];

export class PlannerAgent {
  private readonly logger: Logger;
  private readonly metrics = getMetricsCollector();

  constructor(
    private readonly adapters: Record<string, BaseAdapter>,
    logger?: Logger,
  ) {
    this.logger = logger ?? getLogger("orchestrator.planner");
  }

  async planWorkflow(task: string): Promise<WorkflowStepConfig[]> {
    const agentNames = Object.keys(this.adapters);
    const stats = await this.metrics.getAgentSuccessRates(agentNames);

    const availableAgents: string[] = [];
    for (const [agent, data] of Object.entries(stats)) {
      if (data.totalCalls > 0 && data.successRate < 0.6) {
        this.logger.warning(`Deprioritizing agent '${agent}' due to low success rate: ${data.successRate.toFixed(2)}`);
      } else {
        availableAgents.push(agent);
      }
    }

    let candidates = availableAgents;
    if (!candidates.length) {
      this.logger.warning("All agents have low success rates. Falling back to all adapters.");
      candidates = agentNames;
    }
    if (!candidates.length) {
      this.logger.error("No agents available at all for planning.");
      return [];
    }

    const plannerName = PLANNER_PREFERENCE.find((pref) => candidates.includes(pref)) ?? candidates[0];
    const plannerAdapter = this.adapters[plannerName as string] as BaseAdapter;

    const prompt = `
You are the Orchestrator Planner Agent. Your job is to break down the following task into sequential steps and assign available agents.
Task: ${task}
Available agents: ${candidates.join(", ")}

Respond ONLY with a raw JSON array of objects. Do not include markdown formatting like \`\`\`json ... \`\`\`. Each object must have:
- "agent": the name of the assigned agent
- "task": the task role type (e.g. 'implement', 'review', 'refine', 'test', 'document')
- "description": brief description of what the agent will do

Example output:
[
  {"agent": "${candidates[0]}", "task": "implement", "description": "Write initial code"},
  {"agent": "${candidates[candidates.length - 1]}", "task": "review", "description": "Review code for best practices"}
]
`;

    this.logger.info(`Generating dynamic plan using planner agent '${plannerName}'...`);

    try {
      const response = await plannerAdapter.executeTask(prompt, { role: "planner", agent: plannerName });
      if (!response.success) {
        this.logger.error(`Planner agent failed to generate plan: ${response.error}`);
        return this.fallbackPlan(candidates);
      }

      let text = response.output.trim();
      if (text.startsWith("```json")) text = text.slice(7);
      if (text.startsWith("```")) text = text.slice(3);
      if (text.endsWith("```")) text = text.slice(0, -3);
      text = text.trim();

      const plan = JSON.parse(text) as unknown;
      const validPlan: WorkflowStepConfig[] = [];
      if (Array.isArray(plan)) {
        for (const step of plan) {
          if (step && typeof step === "object" && "agent" in step && "task" in step) {
            const s = step as WorkflowStepConfig;
            if (typeof s.agent === "string" && s.agent in this.adapters) {
              validPlan.push(s);
            } else {
              validPlan.push({ ...s, agent: candidates[0] });
            }
          }
        }
      }

      if (validPlan.length) {
        this.logger.info(`Planner generated a workflow with ${validPlan.length} steps.`);
        return validPlan;
      }
      this.logger.warning("Planner generated an invalid or empty plan. Using fallback.");
      return this.fallbackPlan(candidates);
    } catch (e) {
      this.logger.error(`Failed to parse dynamic plan: ${e}`);
      return this.fallbackPlan(candidates);
    }
  }

  private fallbackPlan(availableAgents: string[]): WorkflowStepConfig[] {
    const agent1 = availableAgents[0] as string;
    const agent2 = availableAgents.length > 1 ? (availableAgents[availableAgents.length - 1] as string) : agent1;
    return [
      { agent: agent1, task: "implement", description: "Create initial implementation" },
      { agent: agent2, task: "review", description: "Review the code" },
    ];
  }
}
