import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProjectId, scanProject } from "./projectScanner.js";

describe("generateProjectId", () => {
  it("is deterministic for the same path", () => {
    expect(generateProjectId("/some/project/path")).toBe(generateProjectId("/some/project/path"));
  });

  it("differs for different paths", () => {
    expect(generateProjectId("/a")).not.toBe(generateProjectId("/b"));
  });

  it("normalizes relative vs. resolved-equivalent paths to the same id", () => {
    expect(generateProjectId("/a/b/../b")).toBe(generateProjectId("/a/b"));
  });

  it("returns a 16-character hex prefix", () => {
    expect(generateProjectId("/whatever")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("scanProject", () => {
  it("detects languages and counts files in a small fixture directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "graph-scan-"));
    try {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "util.py"), "def f():\n    pass\n");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      );

      const result = scanProject(dir);

      expect(result.fileCount).toBe(3);
      expect(result.languages).toContain("TypeScript");
      expect(result.languages).toContain("Python");
      expect(result.frameworks).toContain("React");
      expect(result.projectId).toBe(generateProjectId(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores node_modules and dotfiles when counting files", () => {
    const dir = mkdtempSync(join(tmpdir(), "graph-scan-ignore-"));
    try {
      writeFileSync(join(dir, "main.ts"), "export {};\n");
      const nested = join(dir, "node_modules", "some-pkg");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "index.js"), "module.exports = {};\n");
      writeFileSync(join(dir, ".env"), "SECRET=1\n");

      const result = scanProject(dir);
      expect(result.fileCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
