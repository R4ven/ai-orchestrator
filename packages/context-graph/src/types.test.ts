import { describe, it, expect } from "vitest";
import { createNode, createEdge, NodeType, EdgeType } from "./types.js";

describe("createNode", () => {
  it("fills in sensible defaults", () => {
    const node = createNode({ nodeType: NodeType.TASK });
    expect(node.id).toBeTruthy();
    expect(node.nodeType).toBe(NodeType.TASK);
    expect(node.content).toBe("");
    expect(node.tags).toEqual([]);
    expect(node.metadata).toEqual({});
    expect(node.importanceScore).toBe(1.0);
    expect(node.projectId).toBe("");
    expect(new Date(node.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("lets callers override defaults", () => {
    const node = createNode({ nodeType: NodeType.MISTAKE, title: "oops", tags: ["a", "b"], projectId: "proj1" });
    expect(node.title).toBe("oops");
    expect(node.tags).toEqual(["a", "b"]);
    expect(node.projectId).toBe("proj1");
  });

  it("generates distinct IDs across calls", () => {
    const a = createNode({ nodeType: NodeType.CONCEPT });
    const b = createNode({ nodeType: NodeType.CONCEPT });
    expect(a.id).not.toBe(b.id);
  });
});

describe("createEdge", () => {
  it("defaults to a RELATED_TO edge with weight 1", () => {
    const edge = createEdge({ sourceId: "n1", targetId: "n2" });
    expect(edge.edgeType).toBe(EdgeType.RELATED_TO);
    expect(edge.weight).toBe(1.0);
    expect(edge.sourceId).toBe("n1");
    expect(edge.targetId).toBe("n2");
  });
});
