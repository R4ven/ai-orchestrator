/** Agentic Team execution tools. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgenticTeam } from "../engines.js";
import { safeHandler } from "../toolResult.js";

export function registerAgenticTeamTools(server: McpServer): void {
  server.tool(
    "agentic_team_execute",
    "Execute a task through the Agentic Team's free role-to-role communication runtime.",
    {
      task: z.string().min(1).describe("The task description to execute"),
      max_turns: z.number().int().positive().optional().describe("Override the configured max free-communication turns"),
    },
    safeHandler(async ({ task, max_turns }) => getAgenticTeam().executeTask(task, max_turns)),
  );

  server.tool("agentic_team_list_agents", "List agents currently available to the Agentic Team.", {}, safeHandler(() => getAgenticTeam().getAvailableAgents()));

  server.tool("agentic_team_config", "Return the effective team configuration (lead role, max turns, role->agent bindings).", {}, safeHandler(() => getAgenticTeam().getTeamConfig()));

  server.tool("agentic_team_validate", "Validate role->agent bindings against currently available adapters.", {}, safeHandler(() => getAgenticTeam().validateTeamBindings()));

  server.tool("agentic_team_health", "Report Agentic Team runtime status.", {}, safeHandler(() => getAgenticTeam().getRuntimeStatus()));
}
