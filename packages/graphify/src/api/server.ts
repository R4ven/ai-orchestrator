/** Minimal Graphify REST API (Express) with CORS and structured errors. */
import type { Server } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { getLogger } from "@ai-orchestrator/shared";
import { GraphStore } from "../core/graph.js";
import { toDot, toJson, toMarkdown } from "../export/formatters.js";
import { NodeType } from "../core/schema.js";

const logger = getLogger("graphify.api");

export interface ApiServerOptions {
  dbPath: string;
  port?: number;
}

function asyncRoute(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function startApiServer(options: ApiServerOptions): Server {
  const store = new GraphStore(options.dbPath);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.get(
    "/nodes",
    asyncRoute((req, res) => {
      const nodeType = req.query.type as NodeType | undefined;
      const projectId = req.query.project_id as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json(store.listNodes({ nodeType, projectId, limit }));
    }),
  );

  app.get(
    "/nodes/:id",
    asyncRoute((req, res) => {
      const node = store.getNode(req.params.id as string);
      if (!node) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(node);
    }),
  );

  app.get(
    "/search",
    asyncRoute((req, res) => {
      const query = String(req.query.q ?? "");
      if (!query) {
        res.status(400).json({ error: "missing query parameter 'q'" });
        return;
      }
      const projectId = req.query.project_id as string | undefined;
      const nodeType = req.query.type as NodeType | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json(store.search(query, { projectId, nodeType, limit }));
    }),
  );

  app.get(
    "/stats",
    asyncRoute((req, res) => {
      const projectId = req.query.project_id as string | undefined;
      res.json({ counts: store.countByType(projectId), hotspots: store.mostConnectedNodes(10) });
    }),
  );

  app.get(
    "/path/:start/:end",
    asyncRoute((req, res) => {
      const path = store.findPath(req.params.start as string, req.params.end as string);
      if (!path) {
        res.status(404).json({ error: "no path found" });
        return;
      }
      res.json(path);
    }),
  );

  app.get(
    "/export/:format",
    asyncRoute((req, res) => {
      const projectId = req.query.project_id as string | undefined;
      const { nodes, edges } = store.exportAll(projectId);
      switch (req.params.format) {
        case "json":
          res.type("application/json").send(toJson(nodes, edges));
          return;
        case "dot":
          res.type("text/vnd.graphviz").send(toDot(nodes, edges));
          return;
        case "markdown":
        case "md":
          res.type("text/markdown").send(toMarkdown(nodes, edges));
          return;
        default:
          res.status(400).json({ error: `unknown format: ${req.params.format}` });
      }
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`API error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  const port = options.port ?? 5010;
  const server = app.listen(port, () => logger.info(`Graphify API listening on :${port}`));

  const shutdown = (): void => {
    server.close();
    store.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}
