/** Interactive REPL shell for the Agentic Team runtime. */
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { AgenticTeamEngine } from "../engine.js";

export interface AgenticShellOptions {
  configPath?: string;
  forceOffline?: boolean;
  maxTurns?: number;
}

export async function startAgenticShell(options: AgenticShellOptions = {}): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold.magenta("Agentic Team — Interactive Shell"));
  console.log(chalk.dim("Type a task for the team to discuss and deliver. /help for commands, /exit to quit.\n"));

  const existingProjectPath = process.env.PROJECT_PATH?.trim();
  if (!existingProjectPath) {
    const answer = (await rl.question(chalk.dim("Project path (optional, press Enter to skip): "))).trim();
    if (answer) process.env.PROJECT_PATH = answer;
  }

  const engine = new AgenticTeamEngine({ configPath: options.configPath, forceOffline: options.forceOffline });
  await engine.reload();

  const validation = engine.validateTeamBindings();
  if (!validation.valid) {
    console.log(chalk.yellow(`⚠ Team configuration is not fully valid (${validation.reason}). Some roles may fail.`));
  }

  let running = true;
  let maxTurns = options.maxTurns;

  while (running) {
    const input = (await rl.question(chalk.bold("\nteam> "))).trim();
    if (!input) continue;

    if (input === "/exit" || input === "/quit") {
      running = false;
      continue;
    }
    if (input === "/help") {
      console.log(chalk.bold("\nCommands:"));
      console.log(`  ${chalk.cyan("/agents")}      list available agents`);
      console.log(`  ${chalk.cyan("/status")}      show runtime status and team validation`);
      console.log(`  ${chalk.cyan("/max-turns n")} set the max free-communication turns`);
      console.log(`  ${chalk.cyan("/exit")}        leave the shell`);
      continue;
    }
    if (input === "/agents") {
      console.log(engine.getAvailableAgents().join(", ") || chalk.yellow("(none available)"));
      continue;
    }
    if (input === "/status") {
      console.log(JSON.stringify(engine.getRuntimeStatus(), null, 2));
      continue;
    }
    if (input.startsWith("/max-turns")) {
      const n = parseInt(input.split(/\s+/)[1] ?? "", 10);
      if (Number.isFinite(n) && n > 0) {
        maxTurns = n;
        console.log(chalk.green(`Max turns set to ${n}.`));
      } else {
        console.log(chalk.yellow("Usage: /max-turns <positive integer>"));
      }
      continue;
    }

    try {
      const result = await engine.executeTask(input, maxTurns, (step) => {
        const arrow = step.to_role === "user" ? "→ user" : `→ ${step.to_role}`;
        console.log(chalk.dim(`  [turn ${step.turn}] ${step.from_role} ${arrow} (${step.action})`));
      });
      console.log();
      console.log(result.success ? chalk.green("✓ Finalized") : chalk.yellow("⚠ Ended without a clean finalize"));
      console.log(`\n${result.final_output}`);
    } catch (e) {
      console.log(chalk.red(`Error: ${e instanceof Error ? e.message : e}`));
    }
  }

  rl.close();
  console.log(chalk.dim("\nGoodbye."));
}
