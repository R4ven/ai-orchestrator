import { describe, it, expect } from "vitest";
import { classifyLanguage, generateProjectId, Language, createGraphNode, NodeType } from "./schema.js";

describe("classifyLanguage", () => {
  it("classifies by extension", () => {
    expect(classifyLanguage("src/index.ts")).toBe(Language.TYPESCRIPT);
    expect(classifyLanguage("app.py")).toBe(Language.PYTHON);
    expect(classifyLanguage("main.go")).toBe(Language.GO);
    expect(classifyLanguage("README.md")).toBe(Language.MARKDOWN);
  });

  it("classifies well-known filenames without an extension", () => {
    expect(classifyLanguage("path/to/Dockerfile")).toBe(Language.DOCKERFILE);
    expect(classifyLanguage("Makefile")).toBe(Language.SHELL);
  });

  it("falls back to unknown for unrecognized files", () => {
    expect(classifyLanguage("data.bin")).toBe(Language.UNKNOWN);
  });
});

describe("generateProjectId", () => {
  it("is deterministic and path-normalized", () => {
    expect(generateProjectId("/a/b")).toBe(generateProjectId("/a/b"));
    expect(generateProjectId("/a/b/../b")).toBe(generateProjectId("/a/b"));
  });
});

describe("createGraphNode", () => {
  it("fills in defaults and generates a unique id", () => {
    const node = createGraphNode({ nodeType: NodeType.FUNCTION, name: "foo" });
    expect(node.id).toBeTruthy();
    expect(node.nodeType).toBe(NodeType.FUNCTION);
    expect(node.name).toBe("foo");
    expect(node.metadata).toEqual({});
    expect(node.lineStart).toBe(0);
  });
});
