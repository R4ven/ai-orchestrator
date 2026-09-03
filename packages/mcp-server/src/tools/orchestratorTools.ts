/** Orchestrator execution tools. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkHealth } from "@ai-orchestrator/orchestrator";
import { getOrchestrator } from "../engines.js";
import { safeHandler } from "../toolResult.js";

export function registerOrchestratorTools(server: McpServer): void {
  server.tool(
    "orchestrator_execute",
    "Execute a task through the Orchestrator's step-based workflow pipeline (implement/review/refine).",
    {
      task: z.string().min(1).describe("The task description to execute"),
      workflow: z.string().default("default").describe("Workflow name (default, quick, thorough, review-only, document, dynamic, ...)"),
      max_iterations: z.number().int().positive().optional().describe("Override the configured max iterations"),
    },
    safeHandler(async ({ task, workflow, max_iterations }) => {
      const orchestrator = getOrchestrator();
      return orchestrator.executeTask(task, workflow, max_iterations);
    }),
  );

  server.tool("orchestrator_list_agents", "List agents currently available to the Orchestrator.", {}, safeHandler(() => getOrchestrator().getAvailableAgents()));

  server.tool("orchestrator_list_workflows", "List workflows configured for the Orchestrator.", {}, safeHandler(() => getOrchestrator().getWorkflows()));

  server.tool(
    "orchestrator_health",
    "Report Orchestrator health: per-agent availability and offline mode.",
    {},
    safeHandler(async () => {
      const orchestrator = getOrchestrator();
      return checkHealth(orchestrator.adapters, orchestrator.isOfflineMode);
    }),
  );
}
