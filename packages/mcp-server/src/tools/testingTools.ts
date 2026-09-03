/** Testing tools: scaffold generation, coverage/result parsing. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { safeHandler } from "../toolResult.js";

const FUNCTION_RE = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_][\w]*)/g;

function extractFunctionNames(content: string): string[] {
  return [...content.matchAll(FUNCTION_RE)].map((m) => m[1] ?? m[2]).filter((name): name is string => Boolean(name));
}

export function registerTestingTools(server: McpServer): void {
  server.tool(
    "generate_test_cases",
    "Generate a test scaffold (Vitest/Jest-style) for the exported functions in a source file.",
    { file_path: z.string().min(1), framework: z.enum(["vitest", "jest", "pytest"]).default("vitest") },
    safeHandler(({ file_path, framework }) => {
      if (!existsSync(file_path)) throw new Error(`File not found: ${file_path}`);
      const content = readFileSync(file_path, "utf-8");
      const functions = extractFunctionNames(content);
      const moduleName = basename(file_path, extname(file_path));

      if (framework === "pytest") {
        const body = functions
          .map((fn) => `def test_${fn}():\n    # TODO: exercise ${fn}() with representative inputs\n    assert ${fn} is not None\n`)
          .join("\n");
        return { file: file_path, framework, scaffold: `import pytest\nfrom ${moduleName} import ${functions.join(", ") || "*"}\n\n${body}` };
      }

      const importer = framework === "jest" ? "" : `import { describe, it, expect } from "vitest";\n`;
      const body = functions
        .map((fn) => `  it("${fn} behaves as expected", () => {\n    // TODO: exercise ${fn}(...) with representative inputs\n    expect(${fn}).toBeDefined();\n  });\n`)
        .join("\n");
      return {
        file: file_path,
        framework,
        function_count: functions.length,
        scaffold: `${importer}import { ${functions.join(", ") || "/* exports */"} } from "./${moduleName}";\n\ndescribe("${moduleName}", () => {\n${body}});\n`,
      };
    }),
  );

  server.tool(
    "generate_mock_stubs",
    "Generate mock/stub templates for the exported functions and classes in a file.",
    { file_path: z.string().min(1) },
    safeHandler(({ file_path }) => {
      if (!existsSync(file_path)) throw new Error(`File not found: ${file_path}`);
      const content = readFileSync(file_path, "utf-8");
      const functions = extractFunctionNames(content);
      const classes = [...content.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

      const functionMocks = functions.map((fn) => `export const ${fn} = vi.fn();`);
      const classMocks = classes.map((cls) => `export class ${cls} {\n  // TODO: stub methods used by callers\n}`);

      return { file: file_path, functions, classes, mock_module: [...functionMocks, ...classMocks].join("\n\n") };
    }),
  );

  server.tool(
    "analyze_test_coverage",
    "Summarize an Istanbul coverage-summary.json or lcov.info file.",
    { coverage_file: z.string().min(1) },
    safeHandler(({ coverage_file }) => {
      if (!existsSync(coverage_file)) throw new Error(`Coverage file not found: ${coverage_file}`);
      const content = readFileSync(coverage_file, "utf-8");

      if (coverage_file.endsWith(".json")) {
        const data = JSON.parse(content) as Record<string, { lines?: { pct?: number }; statements?: { pct?: number }; functions?: { pct?: number }; branches?: { pct?: number } }>;
        const total = data.total;
        return {
          coverage_file,
          lines_pct: total?.lines?.pct ?? null,
          statements_pct: total?.statements?.pct ?? null,
          functions_pct: total?.functions?.pct ?? null,
          branches_pct: total?.branches?.pct ?? null,
        };
      }

      // lcov text format: aggregate LF/LH (lines found/hit) across records.
      let linesFound = 0;
      let linesHit = 0;
      for (const line of content.split("\n")) {
        if (line.startsWith("LF:")) linesFound += Number(line.slice(3)) || 0;
        if (line.startsWith("LH:")) linesHit += Number(line.slice(3)) || 0;
      }
      return { coverage_file, lines_found: linesFound, lines_hit: linesHit, lines_pct: linesFound ? Math.round((linesHit / linesFound) * 10000) / 100 : null };
    }),
  );

  server.tool(
    "parse_test_results",
    "Parse a JSON test results file (Vitest/Jest JSON reporter shape) into a pass/fail summary.",
    { results_file: z.string().min(1) },
    safeHandler(({ results_file }) => {
      if (!existsSync(results_file)) throw new Error(`Results file not found: ${results_file}`);
      const data = JSON.parse(readFileSync(results_file, "utf-8")) as {
        numTotalTests?: number;
        numPassedTests?: number;
        numFailedTests?: number;
        numPendingTests?: number;
        testResults?: Array<{ name?: string; status?: string }>;
      };

      return {
        results_file,
        total: data.numTotalTests ?? null,
        passed: data.numPassedTests ?? null,
        failed: data.numFailedTests ?? null,
        pending: data.numPendingTests ?? null,
        failing_suites: (data.testResults ?? []).filter((r) => r.status === "failed").map((r) => r.name),
      };
    }),
  );
}
