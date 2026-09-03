#!/usr/bin/env node
/** `ai-orchestrator` CLI entry point. */
import { Command } from "commander";
import chalk from "chalk";
import { configureLogging } from "@ai-orchestrator/shared";
import { Orchestrator } from "../core/engine.js";
import { validateConfig } from "../infra/configManager.js";
import { startShell } from "./shell.js";

const program = new Command();

program
  .name("ai-orchestrator")
  .description("Step-based workflow orchestrator that coordinates cloud and local AI coding assistants.")
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
  .description("start the interactive orchestrator shell")
  .action(async () => {
    const opts = program.opts();
    await startShell({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
  });

program
  .command("run <task>")
  .description("execute a one-shot task")
  .option("-w, --workflow <name>", "workflow to use", "default")
  .option("-i, --max-iterations <n>", "override max iterations", (v) => parseInt(v, 10))
  .action(async (task: string, cmdOpts: { workflow: string; maxIterations?: number }) => {
    const opts = program.opts();
    const orchestrator = new Orchestrator({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
    await orchestrator.initialize();

    console.log(chalk.cyan(`Running task with workflow '${cmdOpts.workflow}'...`));
    const results = await orchestrator.executeTask(task, cmdOpts.workflow, cmdOpts.maxIterations);

    console.log();
    console.log(results.success ? chalk.green("✓ Task completed successfully") : chalk.red("✗ Task did not fully succeed"));
    if (results.final_output) {
      console.log(chalk.dim("\nFinal output:\n") + String(results.final_output));
    }
    process.exitCode = results.success ? 0 : 1;
  });

program
  .command("agents")
  .description("list available (initialized) agents")
  .action(async () => {
    const opts = program.opts();
    const orchestrator = new Orchestrator({ configPath: opts.config, forceOffline: Boolean(opts.offline) });
    await orchestrator.initialize();
    const agents = orchestrator.getAvailableAgents();
    if (!agents.length) {
      console.log(chalk.yellow("No agents are currently available."));
      return;
    }
    console.log(chalk.bold("Available agents:"));
    for (const name of agents) console.log(`  - ${name}`);
  });

program
  .command("workflows")
  .description("list configured workflows")
  .action(() => {
    const opts = program.opts();
    const orchestrator = new Orchestrator({ configPath: opts.config });
    const workflows = orchestrator.getWorkflows();
    console.log(chalk.bold("Configured workflows:"));
    for (const name of workflows) console.log(`  - ${name}`);
  });

program
  .command("validate")
  .description("validate the agents.yaml configuration")
  .action(() => {
    const opts = program.opts();
    const orchestrator = new Orchestrator({ configPath: opts.config });
    const problems = validateConfig(orchestrator.config);
    if (!problems.length) {
      console.log(chalk.green("✓ Configuration is valid."));
      return;
    }
    console.log(chalk.red(`✗ Configuration has ${problems.length} problem(s):`));
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`Fatal error: ${err instanceof Error ? err.message : err}`));
  process.exitCode = 1;
});
