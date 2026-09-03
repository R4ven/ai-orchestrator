/** Context memory tools: store and retrieve graph-based context. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryManager, NodeType } from "@ai-orchestrator/context-graph";
import { safeHandler } from "../toolResult.js";

let memoryManager: MemoryManager | null = null;

function getMemoryManager(): MemoryManager {
  if (!memoryManager) {
    const dbPath = process.env.ORCHESTRATOR_CONTEXT_DB ?? join(homedir(), ".ai-orchestrator", "context.db");
    memoryManager = new MemoryManager(dbPath);
  }
  return memoryManager;
}

export function registerContextTools(server: McpServer): void {
  server.tool(
    "store_conversation",
    "Store a conversation snippet in context memory.",
    { content: z.string().min(1), metadata: z.record(z.unknown()).optional() },
    safeHandler(({ content, metadata }) => {
      const node = getMemoryManager().storeTask({
        taskDescription: content.slice(0, 120),
        outcome: content,
        success: true,
        durationMs: 0,
        tags: ["conversation"],
      });
      return { success: true, node_id: node.id, message: "Conversation stored successfully", metadata };
    }),
  );

  server.tool(
    "store_task",
    "Store a completed task outcome in context memory.",
    {
      task_description: z.string().min(1),
      outcome: z.string().default(""),
      success: z.boolean().default(true),
      duration_ms: z.number().int().nonnegative().default(0),
      workflow_used: z.string().optional(),
      agents_involved: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    },
    safeHandler(({ task_description, outcome, success, duration_ms, workflow_used, agents_involved, tags }) => {
      const node = getMemoryManager().storeTask({
        taskDescription: task_description,
        outcome,
        success,
        durationMs: duration_ms,
        workflowUsed: workflow_used,
        agentsInvolved: agents_involved,
        tags,
      });
      return { success: true, node_id: node.id };
    }),
  );

  server.tool(
    "log_mistake",
    "Log a mistake with correction and prevention strategy for future recall.",
    {
      error_description: z.string().min(1),
      context: z.string().default(""),
      correction: z.string().default(""),
      prevention_strategy: z.string().optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    },
    safeHandler(({ error_description, context, correction, prevention_strategy, severity }) => {
      const node = getMemoryManager().storeMistake({
        errorType: "logged_mistake",
        errorMessage: error_description,
        contextDescription: context,
        correction,
        preventionStrategy: prevention_strategy,
        severity,
      });
      return { success: true, node_id: node.id };
    }),
  );

  server.tool(
    "search_context",
    "Full-text search across the context graph.",
    { query: z.string().min(1), node_type: z.nativeEnum(NodeType).optional(), limit: z.number().int().positive().max(50).default(10) },
    safeHandler(({ query, node_type, limit }) =>
      getMemoryManager()
        .search(query, { nodeType: node_type, limit })
        .map((r) => ({ id: r.node.id, type: r.node.nodeType, title: r.node.title, score: r.score })),
    ),
  );

  server.tool(
    "get_relevant_context",
    "Get relevant mistakes, patterns, decisions, and prior tasks for a new task description.",
    { task_description: z.string().min(1) },
    safeHandler(({ task_description }) => getMemoryManager().getRelevantContext(task_description)),
  );

  server.tool(
    "store_pattern",
    "Store a recognized code or behavior pattern.",
    {
      pattern_name: z.string().min(1),
      pattern_type: z.string().default("general"),
      description: z.string().min(1),
      examples: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
    },
    safeHandler(({ pattern_name, pattern_type, description, examples, languages }) => {
      const node = getMemoryManager().storePattern({ patternName: pattern_name, patternType: pattern_type, description, examples, languages });
      return { success: true, node_id: node.id };
    }),
  );

  server.tool("get_context_stats", "Return node/edge counts by type for the context graph.", {}, safeHandler(() => getMemoryManager().analytics()));
}
