/** Markdown documentation analyzer: headings become DOCUMENTATION nodes. */
import { Language, NodeType, EdgeType, createGraphNode, createGraphEdge } from "../core/schema.js";
import type { Analyzer, AnalyzeInput, AnalyzeResult } from "./base.js";

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

export class DocAnalyzer implements Analyzer {
  supports(language: Language): boolean {
    return language === Language.MARKDOWN;
  }

  analyze(input: AnalyzeInput): AnalyzeResult {
    const { content, filePath, projectId, fileNodeId, language } = input;
    const nodes: AnalyzeResult["nodes"] = [];
    const edges: AnalyzeResult["edges"] = [];
    const lineOf = (index: number): number => content.slice(0, index).split("\n").length;

    for (const match of content.matchAll(HEADING_RE)) {
      const level = (match[1] as string).length;
      const title = (match[2] as string).trim();
      const node = createGraphNode({
        nodeType: NodeType.DOCUMENTATION,
        name: title,
        qualifiedName: `${filePath}::${title}`,
        filePath,
        language,
        lineStart: lineOf(match.index ?? 0),
        projectId,
        metadata: { heading_level: level },
      });
      nodes.push(node);
      edges.push(createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.DOCUMENTS, projectId }));
    }

    return { nodes, edges };
  }
}
