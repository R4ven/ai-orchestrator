#!/usr/bin/env node
/** Graphify CLI — scan projects, query graphs, and export data. */
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { GraphStore } from "./core/graph.js";
import { Scanner } from "./core/scanner.js";
import { GraphifyConfig } from "./config.js";
import { generateProjectId } from "./core/schema.js";
import { toJson, toDot, toMarkdown, toGraphML } from "./export/formatters.js";
import { startApiServer } from "./api/server.js";

const program = new Command();

function resolveProjectPath(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    console.error(chalk.red(`Not a directory: ${resolved}`));
    process.exit(1);
  }
  return resolved;
}

function openStore(projectPath: string, dbOverride?: string): GraphStore {
  const config = new GraphifyConfig({ dbPath: dbOverride });
  return new GraphStore(config.resolveDbPath(projectPath));
}

program.name("graphify").description("Turn any project directory into a queryable knowledge graph.").version("0.1.0");

program
  .command("scan <path>")
  .description("scan a project and (re)build its graph")
  .option("--db <path>", "override the graph database path")
  .option("--max-files <n>", "maximum number of files to scan", (v) => parseInt(v, 10))
  .action((path: string, opts: { db?: string; maxFiles?: number }) => {
    const projectPath = resolveProjectPath(path);
    const store = openStore(projectPath, opts.db);
    const scanner = new Scanner(projectPath, store, { maxFiles: opts.maxFiles });
    const summary = scanner.scan();
    store.close();

    console.log(chalk.green(`✓ Scanned ${summary.totalFiles} files, ${summary.totalLines} lines`));
    console.log(`  Classes: ${summary.totalClasses}  Functions: ${summary.totalFunctions}  Tests: ${summary.totalTests}`);
    console.log(`  Languages: ${Object.entries(summary.languages).map(([l, c]) => `${l}(${c})`).join(", ")}`);
  });

program
  .command("search <query>")
  .description("full-text search the graph")
  .option("--project <path>", "project path", ".")
  .option("--db <path>", "override the graph database path")
  .option("--limit <n>", "max results", (v) => parseInt(v, 10), 20)
  .action((query: string, opts: { project: string; db?: string; limit: number }) => {
    const projectPath = resolveProjectPath(opts.project);
    const store = openStore(projectPath, opts.db);
    const projectId = generateProjectId(projectPath);
    const results = store.search(query, { projectId, limit: opts.limit });
    store.close();

    if (!results.length) {
      console.log(chalk.yellow("No matches."));
      return;
    }
    for (const { node, score } of results) {
      console.log(`${chalk.cyan(node.nodeType.padEnd(12))} ${node.name || node.filePath}  ${chalk.dim(`(${node.filePath}:${node.lineStart}, score=${score.toFixed(2)})`)}`);
    }
  });

program
  .command("stats <path>")
  .description("show graph statistics for a project")
  .option("--db <path>", "override the graph database path")
  .action((path: string, opts: { db?: string }) => {
    const projectPath = resolveProjectPath(path);
    const store = openStore(projectPath, opts.db);
    const projectId = generateProjectId(projectPath);
    const counts = store.countByType(projectId);
    const hotspots = store.mostConnectedNodes(10);
    store.close();

    console.log(chalk.bold(`Graph stats for ${projectPath}`));
    for (const [type, count] of Object.entries(counts)) console.log(`  ${type.padEnd(14)} ${count}`);
    console.log(chalk.bold("\nMost connected nodes:"));
    for (const { node, degree } of hotspots) console.log(`  ${degree.toString().padStart(4)}  ${node.nodeType} ${node.name || node.filePath}`);
  });

program
  .command("explain <name>")
  .description("show a node's details and connections by name or qualified name")
  .option("--project <path>", "project path", ".")
  .option("--db <path>", "override the graph database path")
  .action((name: string, opts: { project: string; db?: string }) => {
    const projectPath = resolveProjectPath(opts.project);
    const store = openStore(projectPath, opts.db);
    const projectId = generateProjectId(projectPath);
    const results = store.search(name, { projectId, limit: 5 });
    store.close();

    if (!results.length) {
      console.log(chalk.yellow(`No node found matching '${name}'.`));
      return;
    }
    for (const { node } of results) {
      console.log(JSON.stringify(node, null, 2));
    }
  });

program
  .command("path <start> <end>")
  .description("find the shortest path between two node IDs")
  .option("--project <path>", "project path", ".")
  .option("--db <path>", "override the graph database path")
  .action((start: string, end: string, opts: { project: string; db?: string }) => {
    const projectPath = resolveProjectPath(opts.project);
    const store = openStore(projectPath, opts.db);
    const path = store.findPath(start, end);
    store.close();

    if (!path) {
      console.log(chalk.yellow("No path found."));
      return;
    }
    console.log(path.map((n) => `${n.nodeType}:${n.name || n.filePath}`).join(chalk.dim(" -> ")));
  });

program
  .command("export <format> <path>")
  .description("export the graph as json, dot, markdown, or graphml")
  .option("--db <path>", "override the graph database path")
  .option("-o, --output <file>", "output file (defaults to stdout)")
  .action((format: string, path: string, opts: { db?: string; output?: string }) => {
    const projectPath = resolveProjectPath(path);
    const store = openStore(projectPath, opts.db);
    const projectId = generateProjectId(projectPath);
    const { nodes, edges } = store.exportAll(projectId);
    store.close();

    let output: string;
    switch (format) {
      case "json":
        output = toJson(nodes, edges);
        break;
      case "dot":
        output = toDot(nodes, edges);
        break;
      case "markdown":
      case "md":
        output = toMarkdown(nodes, edges, `Graph: ${projectPath}`);
        break;
      case "graphml":
        output = toGraphML(nodes, edges);
        break;
      default:
        console.error(chalk.red(`Unknown export format: ${format}`));
        process.exit(1);
        return;
    }

    if (opts.output) {
      mkdirSync(resolve(opts.output, ".."), { recursive: true });
      writeFileSync(opts.output, output, "utf-8");
      console.log(chalk.green(`✓ Exported to ${opts.output}`));
    } else {
      console.log(output);
    }
  });

program
  .command("serve")
  .description("start the Graphify REST API")
  .option("--db <path>", "graph database path", ".graphify/graph.db")
  .option("--port <n>", "port to listen on", (v) => parseInt(v, 10), 5010)
  .action((opts: { db: string; port: number }) => {
    startApiServer({ dbPath: resolve(opts.db), port: opts.port });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`Fatal error: ${err instanceof Error ? err.message : err}`));
  process.exitCode = 1;
});
