/** Adapter for OpenAI Codex CLI. */
import { AgentCapability, BaseAdapter, type AgentConfig, type AgentResponse } from "./base.js";

const CODE_EXTENSIONS = [".py", ".js", ".ts", ".java", ".go", ".rs"];

export class CodexAdapter extends BaseAdapter {
  constructor(config: AgentConfig) {
    super(config);
    this.command = config.command ?? "codex";
  }

  getCapabilities(): AgentCapability[] {
    return [AgentCapability.IMPLEMENTATION, AgentCapability.TESTING, AgentCapability.DEBUGGING];
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const prompt = this.buildCodexPrompt(task, context);
    const workingDir = (context.working_dir as string) ?? "./workspace";
    const response = await this.runCommandWithPrompt(prompt, workingDir, true);

    if (response.success) {
      for (const f of this.extractGeneratedFiles(response.output)) {
        if (!response.filesModified.includes(f)) response.filesModified.push(f);
      }
    }
    return response;
  }

  private buildCodexPrompt(task: string, context: Record<string, unknown>): string {
    const parts: string[] = [`Task: ${task}`];
    if (context.language) parts.push(`\nLanguage: ${context.language}`);
    if (context.framework) parts.push(`Framework: ${context.framework}`);
    parts.push("\n\nRequirements:");
    parts.push("- Write clean, production-ready code");
    parts.push("- Include comprehensive error handling");
    parts.push("- Add docstrings and comments");
    parts.push("- Follow best practices and design patterns");
    parts.push("- Ensure code is testable");
    if (Array.isArray(context.additional_requirements)) {
      for (const req of context.additional_requirements as string[]) parts.push(`- ${req}`);
    }
    parts.push("\n\nPlease implement a complete, working solution.");
    return parts.join("\n");
  }

  private extractGeneratedFiles(output: string): string[] {
    const files: string[] = [];
    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      const lower = line.toLowerCase();
      if (lower.includes("created:") || lower.includes("generated:")) {
        const idx = line.indexOf(":");
        if (idx !== -1) files.push(line.slice(idx + 1).trim());
      }
      if (CODE_EXTENSIONS.some((ext) => line.endsWith(ext))) files.push(line);
    }
    return files;
  }
}
