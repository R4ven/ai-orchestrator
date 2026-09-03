/** Export a scanned graph to JSON, DOT (Graphviz), or Markdown. */
import type { GraphEdge, GraphNode } from "../core/schema.js";

export function toJson(nodes: GraphNode[], edges: GraphEdge[]): string {
  return JSON.stringify({ nodes, edges }, null, 2);
}

export function toDot(nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines = ["digraph graphify {", '  rankdir="LR";', "  node [shape=box, fontsize=10];"];
  for (const node of nodes) {
    const label = `${node.nodeType}: ${node.name || node.filePath}`.replace(/"/g, '\\"');
    lines.push(`  "${node.id}" [label="${label}"];`);
  }
  for (const edge of edges) {
    lines.push(`  "${edge.sourceId}" -> "${edge.targetId}" [label="${edge.edgeType}"];`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function toMarkdown(nodes: GraphNode[], edges: GraphEdge[], title = "Project Graph"): string {
  const byType = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byType.get(node.nodeType) ?? [];
    list.push(node);
    byType.set(node.nodeType, list);
  }

  const lines = [`# ${title}`, "", `- Nodes: ${nodes.length}`, `- Edges: ${edges.length}`, ""];
  for (const [type, list] of [...byType.entries()].sort()) {
    lines.push(`## ${type} (${list.length})`);
    for (const node of list.slice(0, 200)) {
      lines.push(`- \`${node.name || node.filePath}\`${node.filePath ? ` — ${node.filePath}${node.lineStart ? `:${node.lineStart}` : ""}` : ""}`);
    }
    if (list.length > 200) lines.push(`- ... and ${list.length - 200} more`);
    lines.push("");
  }
  return lines.join("\n");
}

export function toGraphML(nodes: GraphNode[], edges: GraphEdge[]): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="type" for="node" attr.name="type" attr.type="string"/>',
    '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
    '  <key id="edgeType" for="edge" attr.name="edgeType" attr.type="string"/>',
    '  <graph id="G" edgedefault="directed">',
  ];
  for (const node of nodes) {
    lines.push(`    <node id="${esc(node.id)}">`);
    lines.push(`      <data key="type">${esc(node.nodeType)}</data>`);
    lines.push(`      <data key="name">${esc(node.name || node.filePath)}</data>`);
    lines.push("    </node>");
  }
  for (const edge of edges) {
    lines.push(`    <edge source="${esc(edge.sourceId)}" target="${esc(edge.targetId)}">`);
    lines.push(`      <data key="edgeType">${esc(edge.edgeType)}</data>`);
    lines.push("    </edge>");
  }
  lines.push("  </graph>", "</graphml>");
  return lines.join("\n");
}
