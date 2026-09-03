/** Analyzer contract: turns a file's content into graph nodes/edges. */
import type { GraphEdge, GraphNode, Language } from "../core/schema.js";

export interface AnalyzeInput {
  filePath: string;
  relativePath: string;
  content: string;
  language: Language;
  projectId: string;
  fileNodeId: string;
}

export interface AnalyzeResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Analyzer {
  /** Languages this analyzer can handle. */
  supports(language: Language): boolean;
  analyze(input: AnalyzeInput): AnalyzeResult;
}
