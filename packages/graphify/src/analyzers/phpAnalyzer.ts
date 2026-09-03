/** Regex-based PHP analyzer: classes, functions, and imports (use/require/include). */
import { Language, NodeType, EdgeType, createGraphNode, createGraphEdge } from "../core/schema.js";
import type { Analyzer, AnalyzeInput, AnalyzeResult } from "./base.js";

const CLASS_RE = /^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)|^\s*interface\s+([A-Za-z_]\w*)|^\s*trait\s+([A-Za-z_]\w*)/gm;
const FUNCTION_RE = /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z_]\w*)\s*\(/gm;
const USE_RE = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
const REQUIRE_INCLUDE_RE = /\b(?:require|require_once|include|include_once)\s*\(?\s*["']([^"']+)["']/g;

export class PhpAnalyzer implements Analyzer {
  supports(language: Language): boolean {
    return language === Language.PHP;
  }

  analyze(input: AnalyzeInput): AnalyzeResult {
    const { content, filePath, projectId, fileNodeId, language } = input;
    const nodes: AnalyzeResult["nodes"] = [];
    const edges: AnalyzeResult["edges"] = [];
    const lineOf = (index: number): number => content.slice(0, index).split("\n").length;

    for (const match of content.matchAll(CLASS_RE)) {
      const name = (match[1] ?? match[2] ?? match[3]) as string;
      const node = createGraphNode({
        nodeType: NodeType.CLASS,
        name,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.CONTAINS, projectId }));
    }

    for (const match of content.matchAll(FUNCTION_RE)) {
      const name = match[1] as string;
      const node = createGraphNode({
        nodeType: NodeType.FUNCTION,
        name,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.CONTAINS, projectId }));
    }

    for (const match of content.matchAll(USE_RE)) {
      const target = match[1] as string;
      const node = createGraphNode({
        nodeType: NodeType.IMPORT,
        name: target,
        qualifiedName: `${filePath}::import::${target}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
        metadata: { external: true, kind: "use" },
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.IMPORTS, projectId }));
    }

    for (const match of content.matchAll(REQUIRE_INCLUDE_RE)) {
      const target = match[1] as string;
      const node = createGraphNode({
        nodeType: NodeType.IMPORT,
        name: target,
        qualifiedName: `${filePath}::import::${target}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
        metadata: { external: !target.startsWith("."), kind: "require" },
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.IMPORTS, projectId }));
    }

    return { nodes, edges };
  }
}
