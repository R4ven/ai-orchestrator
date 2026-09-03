/** Regex-based JS/TS analyzer: classes, functions, imports.
 *
 * A full TS/Babel AST parse would be more precise, but a regex pass keeps
 * Graphify dependency-light and fast across arbitrarily large trees — the
 * same trade-off the original Python analyzer makes with `ast`-lite parsing
 * for non-Python files.
 */
import { Language, NodeType, EdgeType, createGraphNode, createGraphEdge } from "../core/schema.js";
import type { Analyzer, AnalyzeInput, AnalyzeResult } from "./base.js";

const CLASS_RE = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const FUNCTION_RE =
  /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
const IMPORT_RE = /import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;

export class JavaScriptAnalyzer implements Analyzer {
  supports(language: Language): boolean {
    return language === Language.JAVASCRIPT || language === Language.TYPESCRIPT;
  }

  analyze(input: AnalyzeInput): AnalyzeResult {
    const { content, filePath, projectId, fileNodeId, language } = input;
    const nodes: AnalyzeResult["nodes"] = [];
    const edges: AnalyzeResult["edges"] = [];
    const lineOf = (index: number): number => content.slice(0, index).split("\n").length;

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
      const name = match[1] ?? match[2];
      if (!name) continue;
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
