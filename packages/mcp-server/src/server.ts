/** MCP server construction: registers all tool categories. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSharedTools } from "./tools/sharedTools.js";
import { registerOrchestratorTools } from "./tools/orchestratorTools.js";
import { registerAgenticTeamTools } from "./tools/agenticTeamTools.js";
import { registerContextTools } from "./tools/contextTools.js";
import { registerCodeAnalysisTools } from "./tools/codeAnalysisTools.js";
import { registerSecurityTools } from "./tools/securityTools.js";
import { registerTestingTools } from "./tools/testingTools.js";
import { registerDevopsTools } from "./tools/devopsTools.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "ai-orchestrator-mcp", version: "0.1.0" });

  registerSharedTools(server);
  registerOrchestratorTools(server);
  registerAgenticTeamTools(server);
  registerContextTools(server);
  registerCodeAnalysisTools(server);
  registerSecurityTools(server);
  registerTestingTools(server);
  registerDevopsTools(server);

  return server;
}
