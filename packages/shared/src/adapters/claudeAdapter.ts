/** Adapter for Claude Code CLI. */
import { AgentCapability, BaseAdapter, type AgentConfig, type AgentResponse } from "./base.js";

export class ClaudeAdapter extends BaseAdapter {
  constructor(config: AgentConfig) {
    super(config);
    this.command = config.command ?? "claude";
  }

  getCapabilities(): AgentCapability[] {
    return [
      AgentCapability.IMPLEMENTATION,
      AgentCapability.REFACTORING,
      AgentCapability.CODE_REVIEW,
      AgentCapability.DEBUGGING,
      AgentCapability.DOCUMENTATION,
    ];
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const prompt = this.buildClaudePrompt(task, context);
    const workingDir = (context.working_dir as string) ?? "./workspace";
    const response = await this.runCommandWithPrompt(prompt, workingDir, true);

    if (response.success) {
      response.suggestions = this.extractSuggestions(response.output);
      for (const f of this.extractModifiedFiles(response.output, context)) {
        if (!response.filesModified.includes(f)) response.filesModified.push(f);
      }
    }
    return response;
  }

  private buildClaudePrompt(task: string, context: Record<string, unknown>): string {
    const parts: string[] = [];
    if (context.role === "refine") {
      parts.push("You are refining code based on review feedback.");
      parts.push(`\nTask: ${task}`);
      if (context.feedback) parts.push(`\n\nCode Review Feedback:\n${context.feedback}`);
      if (context.implementation) parts.push(`\n\nCurrent Implementation:\n${context.implementation}`);
      parts.push("\n\nPlease implement the suggested improvements while maintaining code functionality.");
      parts.push("Focus on SOLID principles, clean code, and best practices.");
    } else {
      parts.push(`Task: ${task}`);
      if (context.requirements) parts.push(`\n\nRequirements:\n${context.requirements}`);
    }
    parts.push("\n\nPlease provide clear, well-documented code with proper error handling.");
    return parts.join("\n");
  }

  private extractModifiedFiles(output: string, context: Record<string, unknown>): string[] {
    const files = new Set<string>();
    for (const line of output.split("\n")) {
      const lower = line.toLowerCase();
      if (lower.includes("modified:") || lower.includes("created:")) {
        const idx = line.indexOf(":");
        if (idx !== -1) files.add(line.slice(idx + 1).trim());
      }
    }
    if (Array.isArray(context.files)) {
      for (const f of context.files as string[]) files.add(f);
    }
    return [...files];
  }

  private extractSuggestions(output: string): string[] {
    const suggestions: string[] = [];
    let inSuggestions = false;
    for (const line of output.split("\n")) {
      const lower = line.toLowerCase();
      if (lower.includes("suggestion") || lower.includes("recommendation")) {
        inSuggestions = true;
      } else if (inSuggestions && line.trim().startsWith("-")) {
        suggestions.push(line.trim().slice(1).trim());
      } else if (inSuggestions && !line.trim()) {
        inSuggestions = false;
      }
    }
    return suggestions;
  }
}
