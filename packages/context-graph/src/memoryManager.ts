/** High-level memory API used by the Orchestrator and Agentic Team engines. */
import { GraphStore } from "./store/graphStore.js";
import { createEdge, createNode, EdgeType, NodeType, type GraphNode, type SearchResult } from "./types.js";
import { generateProjectId, scanProject } from "./ops/projectScanner.js";

export interface RelevantContext {
  mistakes: GraphNode[];
  patterns: GraphNode[];
  decisions: GraphNode[];
  tasks: GraphNode[];
}

export class MemoryManager {
  private readonly store: GraphStore;

  constructor(dbPath: string) {
    this.store = new GraphStore(dbPath);
  }

  storeTask(params: {
    taskDescription: string;
    outcome: string;
    success: boolean;
    durationMs: number;
    workflowUsed?: string;
    agentsInvolved?: string[];
    tags?: string[];
    projectId?: string;
  }): GraphNode {
    const node = createNode({
      nodeType: NodeType.TASK,
      title: params.taskDescription.slice(0, 120),
      content: params.taskDescription,
      tags: params.tags ?? [],
      projectId: params.projectId ?? "",
      metadata: {
        outcome: params.outcome,
        success: params.success,
        duration_ms: params.durationMs,
        workflow_used: params.workflowUsed ?? "",
        agents_involved: params.agentsInvolved ?? [],
      },
    });
    return this.store.upsertNode(node);
  }

  storeMistake(params: {
    errorType: string;
    errorMessage: string;
    contextDescription?: string;
    correction?: string;
    preventionStrategy?: string;
    severity?: "low" | "medium" | "high" | "critical";
    projectId?: string;
  }): GraphNode {
    const node = createNode({
      nodeType: NodeType.MISTAKE,
      title: `${params.errorType}: ${params.errorMessage}`.slice(0, 120),
      content: [params.errorMessage, params.contextDescription, params.correction].filter(Boolean).join("\n\n"),
      projectId: params.projectId ?? "",
      metadata: {
        error_type: params.errorType,
        error_message: params.errorMessage,
        context_description: params.contextDescription ?? "",
        correction: params.correction ?? "",
        prevention_strategy: params.preventionStrategy ?? "",
        severity: params.severity ?? "medium",
      },
    });
    return this.store.upsertNode(node);
  }

  storePattern(params: {
    patternName: string;
    patternType: string;
    description: string;
    examples?: string[];
    languages?: string[];
    frameworks?: string[];
    projectId?: string;
  }): GraphNode {
    const node = createNode({
      nodeType: NodeType.PATTERN,
      title: params.patternName,
      content: params.description,
      tags: [params.patternType, ...(params.languages ?? [])],
      projectId: params.projectId ?? "",
      metadata: {
        pattern_name: params.patternName,
        pattern_type: params.patternType,
        examples: params.examples ?? [],
        languages: params.languages ?? [],
        frameworks: params.frameworks ?? [],
      },
    });
    return this.store.upsertNode(node);
  }

  storeDecision(params: {
    decisionTitle: string;
    decisionDescription: string;
    rationale: string;
    alternativesConsidered?: string[];
    tradeOffs?: string;
    projectId?: string;
  }): GraphNode {
    const node = createNode({
      nodeType: NodeType.DECISION,
      title: params.decisionTitle,
      content: params.decisionDescription,
      projectId: params.projectId ?? "",
      metadata: {
        decision_title: params.decisionTitle,
        rationale: params.rationale,
        alternatives_considered: params.alternativesConsidered ?? [],
        trade_offs: params.tradeOffs ?? "",
        status: "accepted",
      },
    });
    return this.store.upsertNode(node);
  }

  registerProject(projectPath: string): GraphNode {
    const scan = scanProject(projectPath);
    const node = createNode({
      id: scan.projectId,
      nodeType: NodeType.PROJECT,
      title: scan.projectName,
      content: `Project at ${scan.projectPath}`,
      projectId: scan.projectId,
      metadata: {
        project_path: scan.projectPath,
        project_name: scan.projectName,
        languages: scan.languages,
        frameworks: scan.frameworks,
        file_count: scan.fileCount,
        last_scanned: new Date().toISOString(),
      },
    });
    return this.store.upsertNode(node);
  }

  rescanProject(projectPath: string): GraphNode {
    return this.registerProject(projectPath);
  }

  deleteProjectGraph(projectId: string): number {
    let removed = 0;
    for (const node of this.store.listNodes({ projectId, limit: 100000 })) {
      this.store.deleteNode(node.id);
      removed += 1;
    }
    return removed;
  }

  search(query: string, options: { nodeType?: NodeType; projectId?: string; limit?: number } = {}): SearchResult[] {
    return this.store.searchFts(query, options);
  }

  /** Gather relevant mistakes, patterns, decisions, and prior tasks for a new task description. */
  getRelevantContext(taskDescription: string, projectId?: string): RelevantContext {
    const mistakes = this.store
      .searchFts(taskDescription, { nodeType: NodeType.MISTAKE, projectId, limit: 5 })
      .map((r) => r.node);
    const patterns = this.store
      .searchFts(taskDescription, { nodeType: NodeType.PATTERN, projectId, limit: 5 })
      .map((r) => r.node);
    const decisions = this.store
      .searchFts(taskDescription, { nodeType: NodeType.DECISION, projectId, limit: 5 })
      .map((r) => r.node);
    const tasks = this.store
      .searchFts(taskDescription, { nodeType: NodeType.TASK, projectId, limit: 5 })
      .map((r) => r.node);

    return { mistakes, patterns, decisions, tasks };
  }

  linkNodes(sourceId: string, targetId: string, edgeType: EdgeType, weight = 1.0): void {
    this.store.addEdge(createEdge({ sourceId, targetId, edgeType, weight }));
  }

  analytics(): { nodeCounts: Record<string, number>; edgeCounts: Record<string, number> } {
    return { nodeCounts: this.store.countByType(), edgeCounts: this.store.countEdgesByType() };
  }

  export(): ReturnType<GraphStore["exportAll"]> {
    return this.store.exportAll();
  }

  pruneOlderThanDays(days: number, keepPinned = true): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.store.pruneOlderThan(cutoff, { keepPinned });
  }

  close(): void {
    this.store.close();
  }
}

export { generateProjectId, scanProject };
