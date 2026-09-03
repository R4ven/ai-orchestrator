/** Shared utility tools. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { engineStatus } from "../engines.js";
import { safeHandler } from "../toolResult.js";

export function registerSharedTools(server: McpServer): void {
  server.tool("list_engines", "List the availability status of the Orchestrator and Agentic Team engines.", {}, safeHandler(() => engineStatus()));
}
