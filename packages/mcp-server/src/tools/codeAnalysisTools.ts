/** Code analysis tools: complexity, patterns, dependencies, summaries.
 *
 * These are lightweight, language-agnostic heuristics (regex/line-based) rather
 * than a full AST parse — a deliberate simplification versus the original
 * Python-`ast`-based analyzer, chosen so the same tools work across the
 * multi-language codebases these agents typically operate on.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { safeHandler } from "../toolResult.js";

const DECISION_KEYWORDS = /\b(if|else if|elif|for|while|case|catch|except|&&|\|\||\?\s*:)\b/g;
const FUNCTION_RE = /\b(?:function|def|fn|func)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
const CLASS_RE = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const IMPORT_RE = /^\s*(?:import .*from ['"]([^'"]+)['"]|import ['"]([^'"]+)['"]|from ([\w.]+) import|require\(['"]([^'"]+)['"]\))/gm;

function readSafe(filePath: string): string {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return readFileSync(filePath, "utf-8");
}

export function registerCodeAnalysisTools(server: McpServer): void {
  server.tool(
    "analyze_complexity",
    "Analyze a source file's approximate cyclomatic complexity and structure.",
    { file_path: z.string().min(1) },
    safeHandler(({ file_path }) => {
      const content = readSafe(file_path);
      const lines = content.split("\n");
      const decisionPoints = (content.match(DECISION_KEYWORDS) ?? []).length;
      const functions = [...content.matchAll(FUNCTION_RE)].length;
      const classes = [...content.matchAll(CLASS_RE)].length;

      return {
        file: file_path,
        line_count: lines.length,
        non_blank_lines: lines.filter((l) => l.trim()).length,
        function_count: functions,
        class_count: classes,
        approximate_cyclomatic_complexity: decisionPoints + 1,
        complexity_rating: decisionPoints < 10 ? "low" : decisionPoints < 25 ? "moderate" : "high",
      };
    }),
  );

  server.tool(
    "find_code_patterns",
    "Scan a directory for common code patterns/anti-patterns (TODOs, debug statements, long files).",
    { directory: z.string().min(1), pattern_type: z.enum(["all", "todos", "debug", "long_files"]).default("all"), max_files: z.number().int().positive().default(500) },
    safeHandler(({ directory, pattern_type, max_files }) => {
      if (!existsSync(directory)) throw new Error(`Directory not found: ${directory}`);

      const findings: Array<{ file: string; kind: string; detail: string }> = [];
      let scanned = 0;

      const walk = (dir: string): void => {
        if (scanned >= max_files) return;
        for (const entry of readdirSync(dir)) {
          if (scanned >= max_files) return;
          if (["node_modules", ".git", "dist", "build", "__pycache__"].includes(entry)) continue;
          const full = join(dir, entry);
          const stats = statSync(full);
          if (stats.isDirectory()) {
            walk(full);
            continue;
          }
          if (![".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(extname(entry))) continue;
          scanned += 1;

          const content = readFileSync(full, "utf-8");
          const lineCount = content.split("\n").length;

          if ((pattern_type === "all" || pattern_type === "todos") && /\b(TODO|FIXME|XXX|HACK)\b/.test(content)) {
            const count = (content.match(/\b(TODO|FIXME|XXX|HACK)\b/g) ?? []).length;
            findings.push({ file: full, kind: "todo_marker", detail: `${count} TODO/FIXME marker(s)` });
          }
          if ((pattern_type === "all" || pattern_type === "debug") && /\b(console\.log|print\(|debugger;|pdb\.set_trace)\b/.test(content)) {
            findings.push({ file: full, kind: "debug_statement", detail: "Contains debug/print statements" });
          }
          if ((pattern_type === "all" || pattern_type === "long_files") && lineCount > 500) {
            findings.push({ file: full, kind: "long_file", detail: `${lineCount} lines` });
          }
        }
      };
      walk(directory);

      return { directory, files_scanned: scanned, findings };
    }),
  );

  server.tool(
    "analyze_dependencies",
    "Analyze project dependencies from package.json or requirements.txt.",
    { manifest_file: z.string().default("package.json") },
    safeHandler(({ manifest_file }) => {
      if (!existsSync(manifest_file)) throw new Error(`Manifest not found: ${manifest_file}`);
      const content = readFileSync(manifest_file, "utf-8");

      if (manifest_file.endsWith(".json")) {
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = { ...pkg.dependencies };
        const devDeps = { ...pkg.devDependencies };
        return {
          manifest: manifest_file,
          dependency_count: Object.keys(deps).length,
          dev_dependency_count: Object.keys(devDeps).length,
          unpinned: Object.entries(deps)
            .filter(([, v]) => v.startsWith("*") || v.startsWith("latest"))
            .map(([k]) => k),
          dependencies: deps,
          dev_dependencies: devDeps,
        };
      }

      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      return {
        manifest: manifest_file,
        dependency_count: lines.length,
        unpinned: lines.filter((l) => !/[=<>~]/.test(l)),
        dependencies: lines,
      };
    }),
  );

  server.tool(
    "generate_code_summary",
    "Generate a structural summary of a code file (functions, classes, imports, line count).",
    { file_path: z.string().min(1) },
    safeHandler(({ file_path }) => {
      const content = readSafe(file_path);
      const functions = [...content.matchAll(FUNCTION_RE)].map((m) => m[1] ?? m[2]).filter(Boolean);
      const classes = [...content.matchAll(CLASS_RE)].map((m) => m[1]);
      const imports = [...content.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter(Boolean);

      return {
        file: file_path,
        line_count: content.split("\n").length,
        functions,
        classes,
        imports: [...new Set(imports)],
      };
    }),
  );
}
