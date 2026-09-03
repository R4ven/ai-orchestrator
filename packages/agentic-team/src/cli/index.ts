#!/usr/bin/env node
/** `agentic-team` CLI entry point. */
import { Command } from "commander";
import chalk from "chalk";
import { configureLogging } from "@ai-orchestrator/shared";
import { AgenticTeamEngine } from "../engine.js";
import { startAgenticShell } from "./shell.js";

const program = new Command();

program
  .name("agentic-team")
  .description("Free role-to-role communication runtime (Project Manager, Architect, Developer, QA, DevOps).")
  .version("0.1.0")
  .option("-c, --config <path>", "path to agents.yaml configuration file")
  .option("--offline", "force offline mode (local agents only)")
  .option("-v, --verbose", "enable debug logging");

program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts();
  configureLogging({ level: opts.verbose ? "debug" : "info" });
});

program
  .command("shell")
  .description("start the interactive agentic-team REPL")
  .option("--max-turns <n>", "maximum free-communication turns", (v) => parseInt(v, 10))
  .action(async (cmdOpts: { maxTurns?: number }) => {
    const opts = program.opts();
    await startAgenticShell({ configPath: opts.config, forceOffline: Boolean(opts.offline), maxTurns: cmdOpts.maxTurns });
  });

program
  .command("run <task>")
  .description("execute a one-shot team task")
  .option("--max-turns <n>", "maximum free-communication turns", (v) => parseInt(v, 10))
  .action(async (task: string, cmdOpts: { maxTurns?: number }) => {
    const opts = program.opts();
    const engine = new AgenticTeamEngine({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
    await engine.reload();

    console.log(chalk.cyan("Running team task..."));
    const result = await engine.executeTask(task, cmdOpts.maxTurns, (step) => {
      console.log(chalk.dim(`  [turn ${step.turn}] ${step.from_role} -> ${step.to_role} (${step.action})`));
    });

    console.log();
    console.log(result.success ? chalk.green("✓ Team finalized the task") : chalk.yellow("⚠ Team stopped without a clean finalize"));
    console.log(`\n${result.final_output}`);
    process.exitCode = result.success ? 0 : 1;
  });

program
  .command("agents")
  .description("list available (initialized) agents")
  .action(async () => {
    const opts = program.opts();
    const engine = new AgenticTeamEngine({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
    await engine.reload();
    const agents = engine.getAvailableAgents();
    console.log(chalk.bold("Available agents:"));
    if (!agents.length) console.log(chalk.yellow("  (none available)"));
    for (const name of agents) console.log(`  - ${name}`);
  });

program
  .command("validate")
  .description("validate role-to-agent bindings")
  .action(async () => {
    const opts = program.opts();
    const engine = new AgenticTeamEngine({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
    await engine.reload();
    const result = engine.validateTeamBindings();
    if (result.valid) {
      console.log(chalk.green("✓ Team configuration is valid."));
      return;
    }
    console.log(chalk.red(`✗ Team configuration is invalid (${result.reason}):`));
    if (result.error) console.log(`  ${result.error}`);
    for (const missing of result.missing_roles) {
      console.log(`  - role '${missing.role}' -> agent '${missing.agent ?? "(none)"}' is unavailable`);
    }
    process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`Fatal error: ${err instanceof Error ? err.message : err}`));
  process.exitCode = 1;
});
