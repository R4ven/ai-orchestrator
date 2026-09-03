/** Prometheus metrics collection for the orchestrator. */
import { Counter, Gauge, Histogram, Registry, Summary } from "prom-client";

export class MetricsCollector {
  readonly registry: Registry;
  readonly tasksTotal: Counter<"workflow" | "status">;
  readonly tasksInProgress: Gauge;
  readonly taskDuration: Histogram<"workflow">;
  readonly agentCallsTotal: Counter<"agent" | "status">;
  readonly agentDuration: Histogram<"agent">;
  readonly agentErrors: Counter<"agent" | "error_type">;
  readonly workflowIterations: Summary<"workflow">;
  readonly workflowSuccessRate: Gauge<"workflow">;
  readonly activeAgents: Gauge;
  readonly cacheHits: Counter;
  readonly cacheMisses: Counter;

  constructor(registry?: Registry) {
    this.registry = registry ?? new Registry();

    this.tasksTotal = new Counter({
      name: "orchestrator_tasks_total",
      help: "Total number of tasks executed",
      labelNames: ["workflow", "status"],
      registers: [this.registry],
    });
    this.tasksInProgress = new Gauge({
      name: "orchestrator_tasks_in_progress",
      help: "Number of tasks currently in progress",
      registers: [this.registry],
    });
    this.taskDuration = new Histogram({
      name: "orchestrator_task_duration_seconds",
      help: "Task execution duration in seconds",
      labelNames: ["workflow"],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [this.registry],
    });
    this.agentCallsTotal = new Counter({
      name: "orchestrator_agent_calls_total",
      help: "Total number of agent calls",
      labelNames: ["agent", "status"],
      registers: [this.registry],
    });
    this.agentDuration = new Histogram({
      name: "orchestrator_agent_duration_seconds",
      help: "Agent execution duration in seconds",
      labelNames: ["agent"],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });
    this.agentErrors = new Counter({
      name: "orchestrator_agent_errors_total",
      help: "Total number of agent errors",
      labelNames: ["agent", "error_type"],
      registers: [this.registry],
    });
    this.workflowIterations = new Summary({
      name: "orchestrator_workflow_iterations",
      help: "Number of iterations per workflow",
      labelNames: ["workflow"],
      registers: [this.registry],
    });
    this.workflowSuccessRate = new Gauge({
      name: "orchestrator_workflow_success_rate",
      help: "Workflow success rate",
      labelNames: ["workflow"],
      registers: [this.registry],
    });
    this.activeAgents = new Gauge({
      name: "orchestrator_active_agents",
      help: "Number of active agents",
      registers: [this.registry],
    });
    this.cacheHits = new Counter({
      name: "orchestrator_cache_hits_total",
      help: "Total number of cache hits",
      registers: [this.registry],
    });
    this.cacheMisses = new Counter({
      name: "orchestrator_cache_misses_total",
      help: "Total number of cache misses",
      registers: [this.registry],
    });
  }

  recordTaskStart(): void {
    this.tasksInProgress.inc();
  }

  recordTaskComplete(workflow: string, success: boolean, duration: number): void {
    const status = success ? "success" : "failure";
    this.tasksTotal.inc({ workflow, status });
    this.tasksInProgress.dec();
    this.taskDuration.observe({ workflow }, duration);
  }

  recordAgentCall(agent: string, success: boolean, duration: number, errorType?: string): void {
    const status = success ? "success" : "failure";
    this.agentCallsTotal.inc({ agent, status });
    this.agentDuration.observe({ agent }, duration);
    if (!success && errorType) this.agentErrors.inc({ agent, error_type: errorType });
  }

  recordWorkflowIterations(workflow: string, iterations: number): void {
    this.workflowIterations.observe({ workflow }, iterations);
  }

  updateActiveAgents(count: number): void {
    this.activeAgents.set(count);
  }

  recordCacheHit(): void {
    this.cacheHits.inc();
  }

  recordCacheMiss(): void {
    this.cacheMisses.inc();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  /** Snapshot of agent success rates, used by the dynamic planner. */
  async getAgentSuccessRates(agentNames: string[]): Promise<Record<string, { successRate: number; totalCalls: number }>> {
    const metricFamily = await this.agentCallsTotal.get();
    const counts = new Map<string, { success: number; failure: number }>();
    for (const value of metricFamily.values) {
      const agent = String(value.labels.agent ?? "");
      const status = String(value.labels.status ?? "");
      const entry = counts.get(agent) ?? { success: 0, failure: 0 };
      if (status === "success") entry.success += value.value;
      else if (status === "failure") entry.failure += value.value;
      counts.set(agent, entry);
    }

    const stats: Record<string, { successRate: number; totalCalls: number }> = {};
    for (const agent of agentNames) {
      const entry = counts.get(agent);
      const total = (entry?.success ?? 0) + (entry?.failure ?? 0);
      stats[agent] = {
        successRate: total > 0 ? (entry?.success ?? 0) / total : 1.0,
        totalCalls: total,
      };
    }
    return stats;
  }
}

let globalCollector: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) globalCollector = new MetricsCollector();
  return globalCollector;
}
