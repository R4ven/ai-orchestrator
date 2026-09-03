/** Adapter for GitHub Copilot CLI. */
import { AgentCapability, BaseAdapter, type AgentConfig, type AgentResponse } from "./base.js";

export class CopilotAdapter extends BaseAdapter {
  constructor(config: AgentConfig) {
    super(config);
    this.command = config.command ?? "github-copilot-cli";
  }

  getCapabilities(): AgentCapability[] {
    return [AgentCapability.IMPLEMENTATION, AgentCapability.DEBUGGING, AgentCapability.TESTING];
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const prompt = this.buildCopilotPrompt(task, context);
    const workingDir = context.working_dir as string | undefined;
    const response = await this.runCommandWithPrompt(prompt, workingDir, false);

    if (response.success) {
      response.suggestions = this.extractCopilotSuggestions(response.output);
    }
    return response;
  }

  private buildCopilotPrompt(task: string, context: Record<string, unknown>): string {
    const parts = [task];
    if (context.code_context) parts.push(`\n\nContext:\n${context.code_context}`);
    if (context.language) parts.push(`\n\nLanguage: ${context.language}`);
    return parts.join("\n");
  }

  private extractCopilotSuggestions(output: string): string[] {
    if (!output.trim()) return [];

    const suggestions: string[] = [];
    let current: string[] = [];

    for (const rawLine of output.split("\n")) {
      const stripped = rawLine.trim();
      if (!stripped) continue;

      const isNewItem =
        (stripped.length > 2 && /\d/.test(stripped[0] as string) && [".", ")"].includes(stripped[1] as string)) ||
        ["- ", "* ", "• "].some((prefix) => stripped.startsWith(prefix));

      if (isNewItem) {
        if (current.length) {
          suggestions.push(current.join("\n").trim());
          current = [];
        }
        current.push(stripped);
      } else if (current.length) {
        current.push(stripped);
      }
    }

    if (current.length) suggestions.push(current.join("\n").trim());
    return suggestions.length ? suggestions : [output.trim()];
  }
}
