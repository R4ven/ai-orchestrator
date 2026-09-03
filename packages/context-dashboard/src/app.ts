/** Flask-app-equivalent: aggregates both context stores behind a small HTTP API + HTML page. */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import express, { type Request, type Response, type NextFunction } from "express";
import { getLogger } from "@ai-orchestrator/shared";
import { MemoryManager, NodeType } from "@ai-orchestrator/context-graph";
import { DASHBOARD_HTML } from "./template.js";

const logger = getLogger("context_dashboard");

export interface DashboardOptions {
  orchestratorDbPath?: string;
  agenticTeamDbPath?: string;
  port?: number;
}

function defaultPaths(): { orchestrator: string; agenticTeam: string } {
  return {
    orchestrator: process.env.ORCHESTRATOR_CONTEXT_DB ?? join(homedir(), ".ai-orchestrator", "context.db"),
    agenticTeam: process.env.AGENTIC_TEAM_CONTEXT_DB ?? join(homedir(), ".agentic-team", "context.db"),
  };
}

function openIfExists(path: string): MemoryManager | null {
  return existsSync(path) ? new MemoryManager(path) : null;
}

function asyncRoute(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      fn(req, res);
    } catch (e) {
      next(e);
    }
  };
}

export function createDashboardApp(options: DashboardOptions = {}): express.Express {
  const paths = defaultPaths();
  const orchestratorDbPath = options.orchestratorDbPath ?? paths.orchestrator;
  const agenticTeamDbPath = options.agenticTeamDbPath ?? paths.agenticTeam;

  const app = express();

  const getStores = (): { orchestrator: MemoryManager | null; agenticTeam: MemoryManager | null } => ({
    orchestrator: openIfExists(orchestratorDbPath),
    agenticTeam: openIfExists(agenticTeamDbPath),
  });

  app.get("/", (_req, res) => {
    res.type("html").send(DASHBOARD_HTML);
  });

  app.get(
    "/api/stats",
    asyncRoute((_req, res) => {
      const { orchestrator, agenticTeam } = getStores();
      try {
        res.json({
          orchestrator: orchestrator ? { available: true, ...orchestrator.analytics() } : { available: false },
          agentic_team: agenticTeam ? { available: true, ...agenticTeam.analytics() } : { available: false },
        });
      } finally {
        orchestrator?.close();
        agenticTeam?.close();
      }
    }),
  );

  app.get(
    "/api/search",
    asyncRoute((req, res) => {
      const query = String(req.query.q ?? "");
      const source = String(req.query.source ?? "both");
      const nodeType = req.query.type as NodeType | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      if (!query) {
        res.status(400).json({ error: "missing query parameter 'q'" });
        return;
      }

      const { orchestrator, agenticTeam } = getStores();
      try {
        const results: Array<Record<string, unknown>> = [];
        if ((source === "both" || source === "orchestrator") && orchestrator) {
          for (const r of orchestrator.search(query, { nodeType, limit })) {
            results.push({ source: "orchestrator", id: r.node.id, type: r.node.nodeType, title: r.node.title, score: r.score });
          }
        }
        if ((source === "both" || source === "agentic_team") && agenticTeam) {
          for (const r of agenticTeam.search(query, { nodeType, limit })) {
            results.push({ source: "agentic_team", id: r.node.id, type: r.node.nodeType, title: r.node.title, score: r.score });
          }
        }
        results.sort((a, b) => (b.score as number) - (a.score as number));
        res.json(results.slice(0, limit));
      } finally {
        orchestrator?.close();
        agenticTeam?.close();
      }
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`Dashboard API error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}

export function startDashboard(options: DashboardOptions = {}): void {
  const app = createDashboardApp(options);
  const port = options.port ?? 5003;
  app.listen(port, () => logger.info(`Context Dashboard listening on http://localhost:${port}`));
}
