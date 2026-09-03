#!/usr/bin/env node
/** Orchestrator Web UI: Express + Socket.IO backend serving a static frontend. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { getLogger } from "@ai-orchestrator/shared";
import { Orchestrator, checkHealth, getMetricsCollector } from "@ai-orchestrator/orchestrator";

const logger = getLogger("orchestrator_ui");
const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const orchestrator = new Orchestrator();
  await orchestrator.initialize();

  const app = express();
  app.use(express.json());
  app.use(express.static(join(here, "..", "public")));

  app.get("/api/agents", (_req, res) => res.json(orchestrator.getAvailableAgents()));
  app.get("/api/workflows", (_req, res) => res.json(orchestrator.getWorkflows()));
  app.get("/api/health", async (_req, res) => res.json(await checkHealth(orchestrator.adapters, orchestrator.isOfflineMode)));

  const metrics = getMetricsCollector();
  app.get("/metrics", async (_req, res) => {
    res.type(metrics.getContentType()).send(await metrics.getMetrics());
  });

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    logger.debug(`UI client connected: ${socket.id}`);

    socket.on("run_task", async (payload: { task?: string; workflow?: string; maxIterations?: number }) => {
      const task = String(payload?.task ?? "").trim();
      const workflow = payload?.workflow || "default";
      if (!task) {
        socket.emit("task_error", { error: "Task description is required." });
        return;
      }

      socket.emit("task_started", { task, workflow });
      try {
        const results = await orchestrator.executeTask(task, workflow, payload?.maxIterations, (step, iteration) => {
          socket.emit("step", { iteration, ...step });
        });
        socket.emit("task_complete", results);
      } catch (e) {
        socket.emit("task_error", { error: e instanceof Error ? e.message : String(e) });
      }
    });

    socket.on("disconnect", () => logger.debug(`UI client disconnected: ${socket.id}`));
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 5001;
  httpServer.listen(port, () => logger.info(`Orchestrator UI listening on http://localhost:${port}`));
}

main().catch((err) => {
  console.error(`Fatal orchestrator-ui error: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});
