/** Security scanning tools: secrets, injection heuristics, headers, audit. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { safeHandler } from "../toolResult.js";

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "generic_api_key", regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi },
  { name: "generic_secret", regex: /(?:secret|token|password|passwd)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
  { name: "github_token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack_token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "private_key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "jwt_like", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
];

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", "venv", ".venv"]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".yaml", ".yml", ".json", ".env", ".sh"]);

function walkFiles(directory: string, maxFiles = 2000): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    if (results.length >= maxFiles) return;
    for (const entry of readdirSync(dir)) {
      if (results.length >= maxFiles) return;
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else if (SCAN_EXTENSIONS.has(extname(entry)) || entry.startsWith(".env")) results.push(full);
    }
  };
  walk(directory);
  return results;
}

function scanFileForSecrets(filePath: string): Array<{ pattern: string; line: number; excerpt: string }> {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const findings: Array<{ pattern: string; line: number; excerpt: string }> = [];

  for (const { name, regex } of SECRET_PATTERNS) {
    for (const match of content.matchAll(new RegExp(regex.source, regex.flags))) {
      const upTo = content.slice(0, match.index ?? 0);
      const lineNo = upTo.split("\n").length;
      findings.push({ pattern: name, line: lineNo, excerpt: (lines[lineNo - 1] ?? "").trim().slice(0, 160) });
    }
  }
  return findings;
}

const INJECTION_CHECKS: Array<[RegExp, string]> = [
  [/\b(SELECT|INSERT|UPDATE|DELETE)\b.{0,80}\+\s*[\w.]+/is, "sql_string_concatenation"],
  [/\bexec\(|\beval\(/i, "eval_or_exec"],
  [/child_process\.exec\(.*\$\{|os\.system\(.*%|subprocess\.(call|run|Popen)\(.*shell\s*=\s*True/i, "shell_command_injection"],
  [/\.innerHTML\s*=/, "dom_xss_innerhtml"],
  [/pickle\.loads\(/i, "unsafe_deserialization"],
];

function scanFileForInjectionRisks(filePath: string): Array<{ line: number; kind: string; excerpt: string }> {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const risks: Array<{ line: number; kind: string; excerpt: string }> = [];

  lines.forEach((line, idx) => {
    for (const [regex, kind] of INJECTION_CHECKS) {
      if (regex.test(line)) risks.push({ line: idx + 1, kind, excerpt: line.trim().slice(0, 160) });
    }
  });
  return risks;
}

export function registerSecurityTools(server: McpServer): void {
  server.tool(
    "scan_secrets",
    "Scan a directory (or single file) for likely hardcoded secrets/credentials.",
    { path: z.string().min(1), max_files: z.number().int().positive().default(2000) },
    safeHandler(({ path, max_files }) => {
      if (!existsSync(path)) throw new Error(`Path not found: ${path}`);
      const files = statSync(path).isDirectory() ? walkFiles(path, max_files) : [path];

      const results: Array<{ file: string; findings: ReturnType<typeof scanFileForSecrets> }> = [];
      for (const file of files) {
        const findings = scanFileForSecrets(file);
        if (findings.length) results.push({ file, findings });
      }

      return { scanned_files: files.length, files_with_findings: results.length, results };
    }),
  );

  server.tool(
    "detect_injection_vulnerabilities",
    "Heuristically detect likely SQL/command/eval injection risks in a file.",
    { file_path: z.string().min(1) },
    safeHandler(({ file_path }) => {
      if (!existsSync(file_path)) throw new Error(`File not found: ${file_path}`);
      const risks = scanFileForInjectionRisks(file_path);
      return { file: file_path, risk_count: risks.length, risks };
    }),
  );

  server.tool(
    "check_security_headers",
    "Heuristically check whether a web app's code configures common security headers/middleware.",
    { code_path: z.string().min(1) },
    safeHandler(({ code_path }) => {
      if (!existsSync(code_path)) throw new Error(`Path not found: ${code_path}`);
      const files = statSync(code_path).isDirectory() ? walkFiles(code_path) : [code_path];
      const combined = files.map((f) => readFileSync(f, "utf-8")).join("\n");

      const checks: Record<string, RegExp> = {
        helmet_or_csp: /helmet\(|Content-Security-Policy/i,
        cors_configured: /\bcors\(/i,
        hsts: /Strict-Transport-Security|hsts/i,
        x_frame_options: /X-Frame-Options/i,
        rate_limiting: /rate.?limit/i,
      };

      const present: Record<string, boolean> = {};
      for (const [key, regex] of Object.entries(checks)) present[key] = regex.test(combined);

      return { scanned_files: files.length, checks: present, missing: Object.entries(present).filter(([, v]) => !v).map(([k]) => k) };
    }),
  );

  server.tool(
    "run_security_audit",
    "Run a combined secret scan + injection heuristic audit across a directory.",
    { directory: z.string().min(1) },
    safeHandler(({ directory }) => {
      if (!existsSync(directory)) throw new Error(`Directory not found: ${directory}`);
      const files = walkFiles(directory);

      let secretFindings = 0;
      let injectionFindings = 0;
      const worstFiles: string[] = [];

      for (const file of files) {
        const secrets = scanFileForSecrets(file);
        const injections = scanFileForInjectionRisks(file);
        secretFindings += secrets.length;
        injectionFindings += injections.length;
        if (secrets.length || injections.length) worstFiles.push(file);
      }

      return {
        directory,
        files_scanned: files.length,
        secret_findings: secretFindings,
        injection_findings: injectionFindings,
        files_flagged: [...new Set(worstFiles)].slice(0, 50),
        summary:
          secretFindings === 0 && injectionFindings === 0
            ? "No obvious secrets or injection risks found."
            : `Found ${secretFindings} potential secret(s) and ${injectionFindings} potential injection risk(s) — review before committing.`,
      };
    }),
  );
}
