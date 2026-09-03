/** Execution, performance, and HTML dashboard report generation. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@ai-orchestrator/shared";

const logger = getLogger("orchestrator.reports");

export interface IterationStepResult {
  agent: string;
  task: string;
  success: boolean;
  output: string;
  error?: string | null;
  files_modified: string[];
  suggestions: string[];
  fallback_from?: string;
}

export interface IterationResult {
  steps: IterationStepResult[];
  final_output: string | null;
}

export interface ExecutionResults {
  task: string;
  workflow: string;
  iterations: IterationResult[];
  final_output: unknown;
  success: boolean;
}

export class ReportGenerator {
  private readonly reportsDir: string;

  constructor(reportsDir = "./reports") {
    this.reportsDir = reportsDir;
    mkdirSync(this.reportsDir, { recursive: true });
  }

  private timestamp(): string {
    const now = new Date();
    const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
      now.getMinutes(),
    )}${pad(now.getSeconds())}`;
  }

  private writeReport(prefix: string, data: Record<string, unknown>): string {
    const filename = `${prefix}_${this.timestamp()}.json`;
    const filePath = join(this.reportsDir, filename);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    this.updateIndex(filename, prefix);
    return filePath;
  }

  private updateIndex(filename: string, type: string): void {
    const indexPath = join(this.reportsDir, "INDEX.json");
    let entries: Array<{ filename: string; type: string; created_at: string }> = [];
    if (existsSync(indexPath)) {
      try {
        entries = JSON.parse(readFileSync(indexPath, "utf-8"));
      } catch {
        entries = [];
      }
    }
    entries.push({ filename, type, created_at: new Date().toISOString() });
    writeFileSync(indexPath, JSON.stringify(entries, null, 2), "utf-8");
  }

  generateExecutionReport(params: {
    task: string;
    workflow: string;
    results: ExecutionResults;
    durationSeconds: number;
    availableAgents: string[];
  }): string {
    const { task, workflow, results, durationSeconds, availableAgents } = params;
    const allSteps = results.iterations.flatMap((i) => i.steps);

    const report = {
      generated_at: new Date().toISOString(),
      task,
      workflow,
      success: results.success,
      duration_seconds: durationSeconds,
      iteration_count: results.iterations.length,
      total_steps: allSteps.length,
      failed_steps: allSteps.filter((s) => !s.success).length,
      available_agents: availableAgents,
      final_output: results.final_output,
      iterations: results.iterations,
    };

    const path = this.writeReport("exec", report);
    logger.info(`Execution report written to ${path}`);
    return path;
  }

  generateHealthReport(health: Record<string, unknown>): string {
    return this.writeReport("health", { generated_at: new Date().toISOString(), ...health });
  }

  generatePerformanceReport(agentStats: Record<string, unknown>): string {
    return this.writeReport("perf", { generated_at: new Date().toISOString(), agents: agentStats });
  }

  generateWorkflowReport(workflowStats: Record<string, unknown>): string {
    return this.writeReport("workflow", { generated_at: new Date().toISOString(), ...workflowStats });
  }

  generateConfigAuditReport(config: Record<string, unknown>, problems: string[]): string {
    return this.writeReport("config", { generated_at: new Date().toISOString(), valid: problems.length === 0, problems, config });
  }

  /** Render a self-contained HTML dashboard listing recorded execution reports. */
  generateHtmlDashboard(): string {
    const indexPath = join(this.reportsDir, "INDEX.json");
    const entries: Array<{ filename: string; type: string; created_at: string }> = existsSync(indexPath)
      ? JSON.parse(readFileSync(indexPath, "utf-8"))
      : [];

    const rows = entries
      .slice()
      .reverse()
      .map((e) => `<tr><td>${e.type}</td><td>${e.filename}</td><td>${e.created_at}</td></tr>`)
      .join("\n");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>AI Orchestrator — Reports Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #0b0f14; color: #e6edf3; }
  h1 { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #22303c; }
  th { color: #8b949e; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
  tr:hover { background: #161b22; }
</style>
</head>
<body>
  <h1>AI Orchestrator — Reports Dashboard</h1>
  <p>${entries.length} report(s) recorded.</p>
  <table>
    <thead><tr><th>Type</th><th>File</th><th>Created</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    const filename = `dashboard_${this.timestamp()}.html`;
    const path = join(this.reportsDir, filename);
    writeFileSync(path, html, "utf-8");
    return path;
  }
}
