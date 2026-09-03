/** Interactive REPL shell for the AI Orchestrator. */
import { createInterface } from "node:readline/promises";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Orchestrator } from "../core/engine.js";

interface HistoryMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

class ConversationHistory {
  messages: HistoryMessage[] = [];
  currentAgent: string | null = null;
  workflow = "default";
  context: Record<string, unknown> = {};

  addMessage(role: string, content: string, metadata: Record<string, unknown> = {}): void {
    this.messages.push({ role, content, timestamp: new Date().toISOString(), metadata });
  }

  clear(): void {
    this.messages = [];
    this.context = {};
  }

  save(filepath: string): void {
    const data = {
      messages: this.messages,
      current_agent: this.currentAgent,
      workflow: this.workflow,
      context: this.context,
      saved_at: new Date().toISOString(),
    };
    writeFileSync(filepath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  load(filepath: string): void {
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    this.messages = data.messages ?? [];
    this.currentAgent = data.current_agent ?? null;
    this.workflow = data.workflow ?? "default";
    this.context = data.context ?? {};
  }
}

export interface ShellOptions {
  configPath?: string;
  forceOffline?: boolean;
}

export async function startShell(options: ShellOptions = {}): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold.cyan("AI Orchestrator — Interactive Shell"));
  console.log(chalk.dim("Type a task to run it with the current workflow, or /help for commands.\n"));

  const existingProjectPath = process.env.PROJECT_PATH?.trim();
  if (!existingProjectPath) {
    const answer = (await rl.question(chalk.dim("Project path (optional, press Enter to skip): "))).trim();
    if (answer) process.env.PROJECT_PATH = answer;
  }

  const orchestrator = new Orchestrator(options);
  await orchestrator.initialize();

  const history = new ConversationHistory();
  const sessionDir = "./sessions";
  mkdirSync(sessionDir, { recursive: true });

  let running = true;

  const commands: Record<string, (args: string) => Promise<void> | void> = {
    "/help": () => cmdHelp(),
    "/exit": () => {
      running = false;
    },
    "/quit": () => {
      running = false;
    },
    "/clear": () => {
      console.clear();
    },
    "/history": () => cmdHistory(history),
    "/agents": () => cmdAgents(orchestrator),
    "/workflows": () => cmdWorkflows(orchestrator),
    "/switch": (args) => cmdSwitchAgent(history, args),
    "/workflow": (args) => cmdSetWorkflow(orchestrator, history, args),
    "/save": (args) => cmdSaveSession(history, sessionDir, args),
    "/load": (args) => cmdLoadSession(history, sessionDir, args),
    "/context": () => cmdShowContext(history),
    "/reset": () => {
      history.clear();
      console.log(chalk.green("Conversation reset."));
    },
    "/info": () => cmdInfo(orchestrator, history),
    "/project": (args) => cmdProject(args),
  };

  while (running) {
    const input = (await rl.question(chalk.bold(`\n[${history.workflow}] > `))).trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.split(/\s+/);
      const handler = commands[(cmd as string).toLowerCase()];
      if (handler) {
        await handler(rest.join(" "));
      } else {
        console.log(chalk.yellow(`Unknown command: ${cmd}. Type /help for a list of commands.`));
      }
      continue;
    }

    history.addMessage("user", input);
    try {
      const results = await orchestrator.executeTask(input, history.workflow);
      history.addMessage("assistant", String(results.final_output ?? ""), { success: results.success });
      console.log();
      console.log(results.success ? chalk.green("✓ Done") : chalk.yellow("⚠ Completed with issues"));
      if (results.final_output) console.log(`\n${String(results.final_output)}`);
    } catch (e) {
      console.log(chalk.red(`Error: ${e instanceof Error ? e.message : e}`));
    }
  }

  rl.close();
  console.log(chalk.dim("\nGoodbye."));
}

function cmdHelp(): void {
  console.log(chalk.bold("\nAvailable commands:"));
  const rows: Array<[string, string]> = [
    ["/help", "Show this help message"],
    ["/exit, /quit", "Exit the shell"],
    ["/clear", "Clear the terminal"],
    ["/history", "Show conversation history"],
    ["/agents", "List available agents"],
    ["/workflows", "List configured workflows"],
    ["/switch <agent>", "Note a preferred agent for follow-ups"],
    ["/workflow <name>", "Switch the active workflow"],
    ["/save <name>", "Save the current session"],
    ["/load <name>", "Load a saved session"],
    ["/context", "Show current conversation context"],
    ["/reset", "Reset conversation history"],
    ["/info", "Show orchestrator status"],
    ["/project <path>", "Set the active project path"],
  ];
  for (const [cmd, desc] of rows) console.log(`  ${chalk.cyan(cmd.padEnd(20))} ${desc}`);
}

function cmdHistory(history: ConversationHistory): void {
  if (!history.messages.length) {
    console.log(chalk.dim("No messages yet."));
    return;
  }
  for (const msg of history.messages) {
    const label = msg.role === "user" ? chalk.blue("you") : chalk.magenta("agent");
    console.log(`${label}: ${msg.content.slice(0, 200)}`);
  }
}

async function cmdAgents(orchestrator: Orchestrator): Promise<void> {
  const agents = orchestrator.getAvailableAgents();
  console.log(chalk.bold("Available agents:"));
  if (!agents.length) console.log(chalk.yellow("  (none available)"));
  for (const name of agents) console.log(`  - ${name}`);
}

function cmdWorkflows(orchestrator: Orchestrator): void {
  console.log(chalk.bold("Configured workflows:"));
  for (const name of orchestrator.getWorkflows()) console.log(`  - ${name}`);
}

function cmdSwitchAgent(history: ConversationHistory, args: string): void {
  if (!args) {
    console.log(chalk.yellow("Usage: /switch <agent-name>"));
    return;
  }
  history.currentAgent = args.trim();
  console.log(chalk.green(`Preferred agent set to '${history.currentAgent}'.`));
}

function cmdSetWorkflow(orchestrator: Orchestrator, history: ConversationHistory, args: string): void {
  const name = args.trim();
  if (!name) {
    console.log(chalk.yellow("Usage: /workflow <name>"));
    return;
  }
  if (!orchestrator.getWorkflows().includes(name)) {
    console.log(chalk.yellow(`Unknown workflow '${name}'. Use /workflows to list available ones.`));
    return;
  }
  history.workflow = name;
  console.log(chalk.green(`Active workflow set to '${name}'.`));
}

function cmdSaveSession(history: ConversationHistory, sessionDir: string, args: string): void {
  const name = args.trim() || `session-${Date.now()}`;
  const path = join(sessionDir, `${name}.json`);
  history.save(path);
  console.log(chalk.green(`Session saved to ${path}`));
}

function cmdLoadSession(history: ConversationHistory, sessionDir: string, args: string): void {
  const name = args.trim();
  if (!name) {
    console.log(chalk.yellow("Usage: /load <session-name>"));
    return;
  }
  const path = join(sessionDir, `${name}.json`);
  if (!existsSync(path)) {
    console.log(chalk.red(`Session not found: ${path}`));
    return;
  }
  history.load(path);
  console.log(chalk.green(`Session loaded from ${path}`));
}

function cmdShowContext(history: ConversationHistory): void {
  console.log(JSON.stringify({ workflow: history.workflow, current_agent: history.currentAgent, context: history.context }, null, 2));
}

async function cmdInfo(orchestrator: Orchestrator, history: ConversationHistory): Promise<void> {
  console.log(chalk.bold("Orchestrator status:"));
  console.log(`  Offline mode: ${orchestrator.isOfflineMode}`);
  console.log(`  Active workflow: ${history.workflow}`);
  console.log(`  Available agents: ${orchestrator.getAvailableAgents().join(", ") || "(none)"}`);
  console.log(`  Project path: ${process.env.PROJECT_PATH ?? "(none)"}`);
}

function cmdProject(args: string): void {
  const path = args.trim();
  if (!path) {
    console.log(chalk.dim(`Current project path: ${process.env.PROJECT_PATH ?? "(none)"}`));
    return;
  }
  process.env.PROJECT_PATH = path;
  console.log(chalk.green(`Project path set to '${path}'. Restart the shell for full re-initialization.`));
}
