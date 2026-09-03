/** Robust CLI communication handler supporting multiple interaction patterns. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import type { Logger } from "../logger.js";
import { getLogger } from "../logger.js";

export type CommunicationMethod = "stdin" | "file" | "arg" | "heredoc";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface WorkspaceExecResult extends ExecResult {
  modifiedFiles: string[];
}

interface CliPattern {
  command?: string;
  method: CommunicationMethod;
  supportsWorkspace: boolean;
  outputFormat: "text" | "json";
  promptFlag?: string;
}

/** Registry of known CLI tool communication patterns. */
export class AgentCLIRegistry {
  private static patterns: Record<string, CliPattern> = {
    claude: { command: "claude", method: "arg", supportsWorkspace: true, outputFormat: "text" },
    codex: { command: "codex", method: "arg", supportsWorkspace: true, outputFormat: "text" },
    gemini: {
      command: "gemini",
      method: "arg",
      promptFlag: "--prompt",
      supportsWorkspace: false,
      outputFormat: "text",
    },
    copilot: { command: "copilot", method: "arg", supportsWorkspace: false, outputFormat: "text" },
    openai: {
      command: "openai",
      method: "arg",
      promptFlag: "--prompt",
      supportsWorkspace: false,
      outputFormat: "json",
    },
  };

  static getPattern(toolName: string): CliPattern {
    return this.patterns[toolName] ?? { method: "stdin", supportsWorkspace: true, outputFormat: "text" };
  }

  static registerPattern(toolName: string, pattern: CliPattern): void {
    this.patterns[toolName] = pattern;
  }
}

function splitCommand(command: string): string[] {
  // Minimal shlex-equivalent: handles quoted segments.
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return parts.map((p) => p.replace(/^['"]|['"]$/g, ""));
}

export class CLICommunicator {
  readonly commandParts: string[];
  readonly commandName: string;
  private readonly logger: Logger;
  private tempDir: string | null = null;

  constructor(
    private readonly command: string,
    logger?: Logger,
  ) {
    this.commandParts = splitCommand(command);
    if (this.commandParts.length === 0) this.commandParts = [command];
    this.commandName = basename(this.commandParts[0] ?? "");
    this.logger = logger ?? getLogger("cli-communicator");
  }

  private async ensureTempDir(): Promise<string> {
    if (!this.tempDir) {
      this.tempDir = await mkdtemp(join(tmpdir(), "ai-orchestrator-"));
    }
    return this.tempDir;
  }

  async executeWithPrompt(
    prompt: string,
    method: CommunicationMethod = "stdin",
    timeout = 3600,
    workingDir?: string,
  ): Promise<ExecResult> {
    switch (method) {
      case "stdin":
        return this.executeStdin(prompt, timeout, workingDir);
      case "file":
        return this.executeFileBased(prompt, timeout, workingDir);
      case "arg":
        return this.executeArgument(prompt, timeout, workingDir);
      case "heredoc":
        return this.executeHeredoc(prompt, timeout, workingDir);
      default:
        return this.executeArgument(prompt, timeout, workingDir);
    }
  }

  /** Pass the prompt on stdin to the CLI process. */
  private async executeStdin(prompt: string, timeout: number, workingDir?: string): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      const child = spawn(this.commandParts[0] as string, this.commandParts.slice(1), {
        cwd: workingDir,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ success: false, stdout, stderr: `Timeout after ${timeout}s` });
      }, timeout * 1000);

      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, stdout, stderr: String(err) });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0, stdout, stderr });
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  /** Write the prompt to an input file and read the CLI's output file. */
  private async executeFileBased(prompt: string, timeout: number, workingDir?: string): Promise<ExecResult> {
    const dir = await this.ensureTempDir();
    const inputFile = join(dir, "input.txt");
    const outputFile = join(dir, "output.txt");

    try {
      await writeFile(inputFile, prompt, "utf-8");

      const result = await this.spawnAndCollect(
        this.commandParts[0] as string,
        [...this.commandParts.slice(1), "--input", inputFile, "--output", outputFile],
        timeout,
        workingDir,
      );

      if (existsSync(outputFile)) {
        const output = await readFile(outputFile, "utf-8");
        return { success: result.success, stdout: output, stderr: result.stderr };
      }
      return result;
    } catch (e) {
      return { success: false, stdout: "", stderr: String(e) };
    } finally {
      await rm(inputFile, { force: true });
      await rm(outputFile, { force: true });
    }
  }

  /** Pass the prompt as a positional/flagged command-line argument, streaming output live. */
  private async executeArgument(prompt: string, timeout: number, workingDir?: string): Promise<ExecResult> {
    const cmd = this.buildCommandForTool(prompt);
    const env = { ...process.env };
    if (this.commandName === "gemini" || this.commandName === "gemini-cli") {
      env.NODE_OPTIONS = "--no-warnings";
    }

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(cmd[0] as string, cmd.slice(1), {
        cwd: workingDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ success: false, stdout, stderr: `Timeout after ${timeout}s` });
      }, timeout * 1000);

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        process.stdout.write(text);
      });
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, stdout, stderr: String(err) });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) this.logger.error(`Command failed with stderr: ${stderr.slice(0, 500)}`);
        resolve({ success: code === 0, stdout, stderr });
      });
    });
  }

  private buildCommandForTool(prompt: string): string[] {
    const parts = this.commandParts;
    if (this.commandName === "codex") {
      if (parts.slice(1).includes("exec")) return [...parts, prompt];
      return [...parts, "exec", prompt];
    }
    if (this.commandName === "gemini" || this.commandName === "gemini-cli") {
      return [...parts, prompt];
    }
    if (this.commandName === "claude") {
      return [...parts, prompt];
    }
    if (this.commandName === "copilot" || this.commandName === "github-copilot-cli") {
      const rest = parts.slice(1);
      const hasPromptFlag = rest.some((p) => p === "-p" || p === "--prompt");
      const hasAllowAllTools = rest.includes("--allow-all-tools");
      const cmd = [...parts];
      if (!hasPromptFlag) cmd.push("-p", prompt);
      else cmd.push(prompt);
      if (!hasAllowAllTools) cmd.push("--allow-all-tools");
      return cmd;
    }
    return [...parts, prompt];
  }

  /** Execute via a bash heredoc, for shell-oriented CLIs. */
  private async executeHeredoc(prompt: string, timeout: number, workingDir?: string): Promise<ExecResult> {
    const script = `${shellQuote(this.command)} << 'EOF'\n${prompt}\nEOF\n`;
    return this.spawnAndCollect("bash", ["-c", script], timeout, workingDir);
  }

  private async spawnAndCollect(
    command: string,
    args: string[],
    timeout: number,
    workingDir?: string,
  ): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      const child = spawn(command, args, { cwd: workingDir, env: process.env });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ success: false, stdout, stderr: `Timeout after ${timeout}s` });
      }, timeout * 1000);

      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, stdout, stderr: String(err) });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0, stdout, stderr });
      });
    });
  }

  /** Execute in a workspace directory, tracking which files were created/modified. */
  async executeInWorkspace(
    prompt: string,
    workspaceDir: string,
    timeout = 3600,
    method: CommunicationMethod = "arg",
  ): Promise<WorkspaceExecResult> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(workspaceDir, { recursive: true });

    const initialState = await this.getFileState(workspaceDir);
    const result = await this.executeWithPrompt(prompt, method, timeout, workspaceDir);
    const modifiedFiles = await this.getModifiedFiles(workspaceDir, initialState);

    return { ...result, modifiedFiles };
  }

  private async getFileState(directory: string): Promise<Map<string, number>> {
    const state = new Map<string, number>();
    if (!existsSync(directory)) return state;
    const { readdir } = await import("node:fs/promises");
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const s = await stat(full);
            state.set(full, s.mtimeMs);
          } catch {
            // ignore transient files
          }
        }
      }
    };
    await walk(directory);
    return state;
  }

  private async getModifiedFiles(directory: string, initial: Map<string, number>): Promise<string[]> {
    const current = await this.getFileState(directory);
    const modified: string[] = [];
    for (const [file, mtime] of current) {
      const before = initial.get(file);
      if (before === undefined || mtime > before) modified.push(file);
    }
    return modified;
  }

  /** Execute with automatic retry on failure, falling back across communication methods. */
  async executeWithRetry(
    prompt: string,
    options: { method?: CommunicationMethod; timeout?: number; workingDir?: string; maxRetries?: number; backoff?: number } = {},
  ): Promise<ExecResult> {
    const { method = "stdin", timeout = 3600, workingDir, maxRetries = 3, backoff = 1.0 } = options;
    const fallbackMethods = this.resolveRetryMethods(method);
    let lastError = "";

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const sleepTime = backoff * 2 ** (attempt - 1);
        this.logger.info(`Retry attempt ${attempt + 1}/${maxRetries} after ${sleepTime}s`);
        await new Promise((r) => setTimeout(r, sleepTime * 1000));
      }

      const currentMethod = fallbackMethods[Math.min(attempt, fallbackMethods.length - 1)] as CommunicationMethod;
      const result = await this.executeWithPrompt(prompt, currentMethod, timeout, workingDir);

      if (result.success) return result;

      if (result.stderr.includes("File is not defined") || result.stderr.includes("ReferenceError")) {
        this.logger.warning(`Node.js compatibility issue detected with ${this.command}`);
        if (attempt === maxRetries - 1) {
          lastError = `Node.js compatibility error. Try upgrading Node.js to v20+.\nOriginal error: ${result.stderr}`;
          break;
        }
      }
      lastError = result.stderr;
    }

    return { success: false, stdout: "", stderr: `Failed after ${maxRetries} attempts. Last error: ${lastError}` };
  }

  private resolveRetryMethods(method: CommunicationMethod): CommunicationMethod[] {
    if (this.commandName === "codex") return ["arg"];
    if (method === "stdin") return ["stdin", "arg", "heredoc"];
    if (method === "arg") return ["arg", "stdin", "heredoc"];
    return [method, "stdin", "arg"];
  }

  async cleanup(): Promise<void> {
    if (this.tempDir && existsSync(this.tempDir)) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
