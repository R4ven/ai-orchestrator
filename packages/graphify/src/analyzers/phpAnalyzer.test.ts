import { describe, it, expect } from "vitest";
import { PhpAnalyzer } from "./phpAnalyzer.js";
import { Language, NodeType, EdgeType } from "../core/schema.js";

describe("PhpAnalyzer", () => {
  const analyzer = new PhpAnalyzer();

  it("supports only PHP", () => {
    expect(analyzer.supports(Language.PHP)).toBe(true);
    expect(analyzer.supports(Language.PYTHON)).toBe(false);
  });

  it("extracts classes, functions, use imports, and require/include targets", () => {
    const content = `<?php
namespace App\\Controllers;

use App\\Models\\User;
require_once 'bootstrap.php';

class UserController
{
    public function index()
    {
        return "ok";
    }

    private function helper() {}
}

interface Loggable {}
`;

    const result = analyzer.analyze({
      filePath: "app/UserController.php",
      relativePath: "app/UserController.php",
      content,
      language: Language.PHP,
      projectId: "proj1",
      fileNodeId: "file-1",
    });

    const classNames = result.nodes.filter((n) => n.nodeType === NodeType.CLASS).map((n) => n.name);
    expect(classNames).toEqual(["UserController", "Loggable"]);

    const functionNames = result.nodes.filter((n) => n.nodeType === NodeType.FUNCTION).map((n) => n.name);
    expect(functionNames).toEqual(["index", "helper"]);

    const importNames = result.nodes.filter((n) => n.nodeType === NodeType.IMPORT).map((n) => n.name);
    expect(importNames).toContain("App\\Models\\User");
    expect(importNames).toContain("bootstrap.php");

    expect(result.edges.every((e) => e.sourceId === "file-1")).toBe(true);
    expect(result.edges.some((e) => e.edgeType === EdgeType.CONTAINS)).toBe(true);
    expect(result.edges.some((e) => e.edgeType === EdgeType.IMPORTS)).toBe(true);
  });
});
