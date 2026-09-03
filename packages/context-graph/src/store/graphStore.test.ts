import { describe, it, expect, afterEach } from "vitest";
import { GraphStore } from "./graphStore.js";
import { createNode, createEdge, NodeType, EdgeType } from "../types.js";

describe("GraphStore", () => {
  let store: GraphStore;

  afterEach(() => {
    store?.close();
  });

  it("round-trips a node through upsert and getNode", () => {
    store = new GraphStore(":memory:");
    const node = createNode({ nodeType: NodeType.PATTERN, title: "Singleton", content: "a pattern" });
    store.upsertNode(node);

    const fetched = store.getNode(node.id);
    expect(fetched?.title).toBe("Singleton");
    expect(fetched?.nodeType).toBe(NodeType.PATTERN);
  });

  it("finds nodes via full-text search on title/content", () => {
    store = new GraphStore(":memory:");
    store.upsertNode(createNode({ nodeType: NodeType.PATTERN, title: "Retry with backoff", content: "resilience pattern" }));
    store.upsertNode(createNode({ nodeType: NodeType.PATTERN, title: "Circuit breaker", content: "unrelated to retries" }));

    const results = store.searchFts("retry");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.node.title).toBe("Retry with backoff");
  });

  it("scopes listNodes and search by nodeType and projectId", () => {
    store = new GraphStore(":memory:");
    store.upsertNode(createNode({ nodeType: NodeType.TASK, title: "task in project A", projectId: "A" }));
    store.upsertNode(createNode({ nodeType: NodeType.TASK, title: "task in project B", projectId: "B" }));
    store.upsertNode(createNode({ nodeType: NodeType.MISTAKE, title: "mistake in project A", projectId: "A" }));

    expect(store.listNodes({ projectId: "A" })).toHaveLength(2);
    expect(store.listNodes({ projectId: "A", nodeType: NodeType.TASK })).toHaveLength(1);
  });

  it("stores edges and counts nodes/edges by type", () => {
    store = new GraphStore(":memory:");
    const a = createNode({ nodeType: NodeType.TASK });
    const b = createNode({ nodeType: NodeType.MISTAKE });
    store.upsertNode(a);
    store.upsertNode(b);
    store.addEdge(createEdge({ sourceId: a.id, targetId: b.id, edgeType: EdgeType.CAUSED_BY }));

    expect(store.countByType()).toEqual({ task: 1, mistake: 1 });
    expect(store.countEdgesByType()).toEqual({ caused_by: 1 });
    expect(store.getEdgesForNode(a.id)).toHaveLength(1);
  });

  it("deletes a node via deleteNode", () => {
    store = new GraphStore(":memory:");
    const node = createNode({ nodeType: NodeType.CONCEPT });
    store.upsertNode(node);
    store.deleteNode(node.id);
    expect(store.getNode(node.id)).toBeNull();
  });
});
