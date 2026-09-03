/** Adapter for Google Gemini CLI. */
import { AgentCapability, BaseAdapter, type AgentConfig, type AgentResponse } from "./base.js";

const NUMBERED_ITEM_RE = /^\d+\./;
const BULLETED_ITEM_RE = /^[-*•]/;
const FILE_PATTERN_RE = /`([^`]+\.(?:py|js|ts|java|go|rs|cpp|h))`/g;

export class GeminiAdapter extends BaseAdapter {
  constructor(config: AgentConfig) {
    super(config);
    this.command = config.command ?? "gemini-cli";
  }

  getCapabilities(): AgentCapability[] {
    return [
      AgentCapability.CODE_REVIEW,
      AgentCapability.ARCHITECTURE,
      AgentCapability.TESTING,
      AgentCapability.DOCUMENTATION,
    ];
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const prompt = this.buildReviewPrompt(task, context);
    const workingDir = context.working_dir as string | undefined;
    const response = await this.runCommandWithPrompt(prompt, workingDir, false);

    if (response.success) {
      response.suggestions = this.parseReviewFeedback(response.output);
      const files = this.extractMentionedFiles(response.output, context);
      if (files.length) response.filesModified = files;
    }
    return response;
  }

  private buildReviewPrompt(task: string, context: Record<string, unknown>): string {
    const parts: string[] = [];
    parts.push("You are an expert code reviewer. Please analyze the following code.");
    parts.push(`\nTask: ${task}`);
    if (context.implementation) {
      parts.push("\n\nCode to Review:\n```");
      parts.push(String(context.implementation));
      parts.push("```");
    }
    parts.push("\n\nPlease review this code focusing on:");
    parts.push("\n**SOLID Principles:**");
    parts.push("- Single Responsibility Principle");
    parts.push("- Open/Closed Principle");
    parts.push("- Liskov Substitution Principle");
    parts.push("- Interface Segregation Principle");
    parts.push("- Dependency Inversion Principle");
    parts.push("\n**Code Quality:**");
    parts.push("- Design patterns and architectural decisions");
    parts.push("- Error handling and edge cases");
    parts.push("- Performance considerations");
    parts.push("- Security vulnerabilities");
    parts.push("- Code readability and maintainability");
    parts.push("- Test coverage and testability");
    parts.push("\n**Best Practices:**");
    parts.push("- Naming conventions");
    parts.push("- Documentation and comments");
    parts.push("- Code organization");
    parts.push("- DRY (Don't Repeat Yourself)");
    parts.push("- KISS (Keep It Simple, Stupid)");
    parts.push("\n\nProvide specific, actionable feedback with examples.");
    parts.push("Prioritize issues by severity: Critical, High, Medium, Low.");
    return parts.join("\n");
  }

  private parseReviewFeedback(output: string): string[] {
    const suggestions: string[] = [];
    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      if (NUMBERED_ITEM_RE.test(line)) {
        suggestions.push(line);
      } else if (BULLETED_ITEM_RE.test(line)) {
        suggestions.push(line.slice(1).trim());
      } else if (["critical:", "high:", "medium:", "low:"].some((s) => line.toLowerCase().includes(s))) {
        suggestions.push(line);
      }
    }
    return suggestions;
  }

  private extractMentionedFiles(output: string, context: Record<string, unknown>): string[] {
    const files = new Set<string>();
    for (const match of output.matchAll(FILE_PATTERN_RE)) {
      if (match[1]) files.add(match[1]);
    }
    if (Array.isArray(context.files)) {
      for (const f of context.files as string[]) files.add(f);
    }
    return [...files];
  }
}
