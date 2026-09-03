/** Config file analyzer: JSON/YAML/TOML root-level keys become CONFIG metadata. */
import { load as loadYaml } from "js-yaml";
import { Language, NodeType, EdgeType, createGraphNode, createGraphEdge } from "../core/schema.js";
import type { Analyzer, AnalyzeInput, AnalyzeResult } from "./base.js";

export class ConfigAnalyzer implements Analyzer {
  supports(language: Language): boolean {
    return language === Language.JSON || language === Language.YAML || language === Language.TOML;
  }

  analyze(input: AnalyzeInput): AnalyzeResult {
    const { content, filePath, projectId, language, fileNodeId } = input;
    let keys: string[] = [];

    try {
      if (language === Language.JSON) {
        keys = Object.keys(JSON.parse(content) as Record<string, unknown>);
      } else if (language === Language.YAML) {
        const doc = loadYaml(content);
        if (doc && typeof doc === "object") keys = Object.keys(doc as Record<string, unknown>);
      } else {
        // Minimal TOML root-key scan (top-level `key = value` and `[section]` lines).
        keys = [...content.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1] as string);
      }
    } catch {
      // malformed config — still index the file, just without extracted keys
    }

    const node = createGraphNode({
      nodeType: NodeType.CONFIG,
      name: filePath.split("/").pop() ?? filePath,
      qualifiedName: filePath,
      filePath,
      language,
      projectId,
      metadata: { keys: keys.slice(0, 100) },
    });

    const edge = createGraphEdge({ sourceId: fileNodeId, targetId: node.id, edgeType: EdgeType.CONFIGURED_BY, projectId });
    return { nodes: [node], edges: [edge] };
  }
}
