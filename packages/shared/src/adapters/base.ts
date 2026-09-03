/** Base adapter interface for AI coding assistants. */
import { execFileSync } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";
import { existsSync, accessSync, constants } from "node:fs";
import type { Logger } from "../logger.js";
import { getLogger } from "../logger.js";
import { AgentCLIRegistry, CLICommunicator, type CommunicationMethod } from "./cliCommunicator.js";

export enum AgentCapability {
  IMPLEMENTATION = "implementation",
  CODE_REVIEW = "code_review",
  REFACTORING = "refactoring",
  TESTING = "testing",
  DOCUMENTATION = "documentation",
  DEBUGGING = "debugging",
  ARCHITECTURE = "architecture",
}

export interface AgentResponse {
  success: boolean;
  output: string;
  error?: string;
  filesModified: string[];
  suggestions: string[];
  metadata: Record<string, unknown>;
}

export function makeResponse(partial: Partial<AgentResponse> & Pick<AgentResponse, "success" | "output">): AgentResponse {
  return {
    filesModified: [],
    suggestions: [],
    metadata: {},
    ...partial,
  };
}

export interface AgentConfig {
  name?: string;
  command?: string;
  endpoint?: string;
  enabled?: boolean;
  timeout?: number;
  offline?: boolean;
  type?: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  model?: string;
  [key: string]: unknown;
}

/** Locate an executable on PATH, mirroring Python's shutil.which(). */
export function which(command: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = isAbsolute(command) ? command : join(dir, command + ext);
      try {
        if (existsSync(candidate)) {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        // not accessible, keep searching
      }
    }
  }
  return null;
}

export abstract class BaseAdapter {
  readonly config: AgentConfig;
  readonly name: string;
  command: string;
  endpoint: string;
  enabled: boolean;
  timeout: number;
  protected readonly logger: Logger;
  protected cliCommunicator: CLICommunicator | null = null;
  protected readonly cliPattern: ReturnType<typeof AgentCLIRegistry.getPattern>;
  protected readonly communicationMethod: CommunicationMethod;

  constructor(config: AgentConfig) {
    this.config = config;
    this.name = config.name ?? this.constructor.name;
    this.command = config.command ?? "";
    this.endpoint = String(config.endpoint ?? "");
    this.enabled = config.enabled ?? true;
    this.timeout = config.timeout ?? 3600;
    this.logger = getLogger(`adapter.${this.name}`);

    if (!config.offline) {
      this.cliCommunicator = new CLICommunicator(this.command, this.logger);
    }

    this.cliPattern = AgentCLIRegistry.getPattern(this.name);
    this.communicationMethod = (this.cliPattern.method ?? "stdin") as CommunicationMethod;
  }

  abstract getCapabilities(): AgentCapability[];
  abstract executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse>;

  isAvailable(): boolean {
    if (!this.enabled) return false;
    try {
      const parts = this.command.split(/\s+/).filter(Boolean);
      const commandToCheck = parts[0] ?? this.command;
      return which(commandToCheck) !== null;
    } catch (e) {
      this.logger.warning(`Failed to check availability: ${e}`);
      return false;
    }
  }

  /**
   * Async availability check. CLI-backed adapters delegate to the synchronous
   * PATH lookup; HTTP-backed local adapters (Ollama/llama.cpp) override this
   * to probe their endpoint instead.
   */
  async checkAvailability(): Promise<boolean> {
    return this.isAvailable();
  }

  protected async runCommandWithPrompt(
    prompt: string,
    workingDir?: string,
    useWorkspace = true,
  ): Promise<AgentResponse> {
    if (!this.cliCommunicator) {
      return makeResponse({
        success: false,
        output: "",
        error: "CLI communicator not initialized (offline mode or missing command config)",
      });
    }

    try {
      this.logger.info(`Executing ${this.command} with prompt (method: ${this.communicationMethod})`);

      if (useWorkspace && this.cliPattern.supportsWorkspace) {
        const dir = workingDir ?? "./workspace";
        const result = await this.cliCommunicator.executeInWorkspace(prompt, dir, this.timeout, this.communicationMethod);
        return makeResponse({
          success: result.success,
          output: result.stdout,
          error: result.success ? undefined : result.stderr,
          filesModified: result.modifiedFiles,
          metadata: { method: this.communicationMethod, working_dir: dir },
        });
      }

      const result = await this.cliCommunicator.executeWithRetry(prompt, {
        method: this.communicationMethod,
        timeout: this.timeout,
        workingDir,
        maxRetries: 2,
      });

      return makeResponse({
        success: result.success,
        output: result.stdout,
        error: result.success ? undefined : result.stderr,
        metadata: { method: this.communicationMethod },
      });
    } catch (e) {
      this.logger.error(`Command execution failed: ${e}`);
      return makeResponse({ success: false, output: "", error: String(e) });
    }
  }

  protected async runHttpWithPrompt(payload: Record<string, unknown>): Promise<AgentResponse> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout * 1000);
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return makeResponse({ success: false, output: "", error: `HTTP error: ${res.status} ${res.statusText}` });
      }
      const data = (await res.json()) as unknown;
      return makeResponse({
        success: true,
        output: typeof data === "string" ? data : JSON.stringify(data),
        metadata: typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {},
      });
    } catch (e) {
      this.logger.error(`${this.name} execution failed: ${e}`);
      return makeResponse({ success: false, output: "", error: `Connection error: ${e}` });
    }
  }

  protected runCommand(args: string[], stdinInput?: string): AgentResponse {
    try {
      this.logger.info(`Executing: ${args.join(" ")}`);
      const [cmd, ...rest] = args;
      const output = execFileSync(cmd as string, rest, {
        input: stdinInput,
        timeout: this.timeout * 1000,
        encoding: "utf-8",
      });
      return makeResponse({ success: true, output, metadata: { command: args.join(" ") } });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return makeResponse({ success: false, output: err.stdout ?? "", error: err.stderr ?? err.message ?? String(e) });
    }
  }

  formatTaskPrompt(task: string, context: Record<string, unknown>): string {
    const parts = [task];
    if (context.previous_output) parts.push(`\n\nPrevious output:\n${context.previous_output}`);
    if (context.feedback) parts.push(`\n\nFeedback to address:\n${context.feedback}`);
    if (Array.isArray(context.files) && context.files.length) parts.push(`\n\nRelevant files: ${context.files.join(", ")}`);
    return parts.join("\n");
  }

  protected buildLocalLlmPrompt(task: string, context: Record<string, unknown>): string {
    const parts: string[] = [];
    const role = (context.role as string) ?? "general";

    if (role === "implement") {
      parts.push("You are an expert software engineer.");
      parts.push("Implement the following task with clean, production-ready code.");
      parts.push(`\nTask:\n${task}`);
    } else if (role === "review") {
      parts.push("You are an expert code reviewer.");
      parts.push("Review the following implementation and provide actionable feedback.");
      parts.push(`\nTask:\n${task}`);
      if (context.implementation) {
        parts.push("\nImplementation to Review:\n```");
        parts.push(String(context.implementation));
        parts.push("```");
      }
    } else if (role === "refine") {
      parts.push("You are refining code based on review feedback.");
      parts.push(`\nTask:\n${task}`);
      if (context.feedback) parts.push(`\nReview Feedback:\n${context.feedback}`);
      if (context.implementation) {
        parts.push("\nCurrent Implementation:\n```");
        parts.push(String(context.implementation));
        parts.push("```");
      }
      parts.push("\nPlease improve the implementation while preserving functionality.");
    } else if (role === "test") {
      parts.push("Write comprehensive tests for the following task.");
      parts.push(`\nTask:\n${task}`);
    } else if (role === "document") {
      parts.push("Write clear documentation for the following implementation.");
      parts.push(`\nTask:\n${task}`);
    } else {
      parts.push(task);
    }

    parts.push("\n\nGeneral Requirements:");
    parts.push("- Follow clean code principles");
    parts.push("- Use proper error handling");
    parts.push("- Ensure readability and maintainability");
    parts.push("- Keep the solution concise but complete");

    if (context.previous_output) {
      parts.push("\n\nPrevious Output:");
      parts.push(String(context.previous_output));
    }

    return parts.join("\n");
  }

  toString(): string {
    return `${this.name} (command: ${this.command})`;
  }
}
