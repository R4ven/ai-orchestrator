/** Schema definitions for the graph context base: nodes and edges. */
import { randomUUID } from "node:crypto";

export enum NodeType {
  CONVERSATION = "conversation",
  TASK = "task",
  MISTAKE = "mistake",
  PATTERN = "pattern",
  DECISION = "decision",
  CODE_SNIPPET = "code_snippet",
  PREFERENCE = "preference",
  FILE = "file",
  CONCEPT = "concept",
  AGENT_OUTPUT = "agent_output",
  PROJECT = "project",
}

export enum EdgeType {
  RELATED_TO = "related_to",
  CAUSED_BY = "caused_by",
  FIXED_BY = "fixed_by",
  SIMILAR_TO = "similar_to",
  DEPENDS_ON = "depends_on",
  PRECEDED_BY = "preceded_by",
  FOLLOWED_BY = "followed_by",
  LEARNED_FROM = "learned_from",
  REFERENCES = "references",
  CONTAINS = "contains",
  PRODUCED_BY = "produced_by",
  USED_IN = "used_in",
}

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  content: string;
  title: string;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  importanceScore: number;
  projectId: string;
}

export function createNode(partial: Partial<GraphNode> & { nodeType: NodeType }): GraphNode {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? randomUUID(),
    content: "",
    title: "",
    metadata: {},
    tags: [],
    createdAt: now,
    updatedAt: now,
    importanceScore: 1.0,
    projectId: "",
    ...partial,
  };
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: EdgeType;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function createEdge(partial: Partial<GraphEdge> & { sourceId: string; targetId: string }): GraphEdge {
  return {
    id: partial.id ?? randomUUID(),
    edgeType: EdgeType.RELATED_TO,
    weight: 1.0,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export interface SearchResult {
  node: GraphNode;
  score: number;
  matchType: "fts" | "hybrid" | "recent" | "exact";
  highlights: string[];
}
