#!/usr/bin/env node
/** MCP server entry point (stdio transport). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getLogger } from "@ai-orchestrator/shared";
import { createServer } from "./server.js";
import { initEngines } from "./engines.js";

const logger = getLogger("mcp_server");

async function main(): Promise<void> {
  logger.info("Initializing Orchestrator and Agentic Team engines...");
  await initEngines();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("AI Orchestrator MCP server running on stdio.");
}

main().catch((err) => {
  console.error(`Fatal MCP server error: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});

export { createServer } from "./server.js";
export * from "./engines.js";
