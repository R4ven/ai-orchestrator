/** Regex-based Python analyzer: classes, functions, imports. */
import { Language, NodeType, EdgeType, createGraphNode, createGraphEdge } from "../core/schema.js";
import type { Analyzer, AnalyzeInput, AnalyzeResult } from "./base.js";

const CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/gm;
const FUNCTION_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm;
const IMPORT_RE = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;

export class PythonAnalyzer implements Analyzer {
  supports(language: Language): boolean {
    return language === Language.PYTHON;
  }

  analyze(input: AnalyzeInput): AnalyzeResult {
    const { content, filePath, projectId, fileNodeId, language } = input;
    const nodes: AnalyzeResult["nodes"] = [];
    const edges: AnalyzeResult["edges"] = [];
    const lineOf = (index: number): number => content.slice(0, index).split("\n").length;
    const isTest = /(^|\/)(test_|_test\.py$)/i.test(filePath) || filePath.includes("/tests/");

    for (const match of content.matchAll(CLASS_RE)) {
      const name = match[1] as string;
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
        nodeType: isTest && name.startsWith("test_") ? NodeType.TEST : NodeType.FUNCTION,
        name,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
      });
      nodes.push(node);
      edges.push(
        createGraphEdge({
          sourceId: fileNodeId,
          targetId: node.id,
          edgeType: node.nodeType === NodeType.TEST ? EdgeType.TESTS : EdgeType.CONTAINS,
          projectId,
        }),
      );
    }

    for (const match of content.matchAll(IMPORT_RE)) {
      const target = match[1] ?? match[2];
      if (!target) continue;
      const node = createGraphNode({
        nodeType: NodeType.IMPORT,
        name: target,
        qualifiedName: `${filePath}::import::${target}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
        metadata: { external: !target.startsWith(".") },
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.IMPORTS, projectId }));
    }

    return { nodes, edges };
  }
}
