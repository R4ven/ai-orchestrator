/** Lightweight project scanning: deterministic project IDs and language/framework detection. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".swift": "Swift",
  ".kt": "Kotlin",
};

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "venv", ".venv", "__pycache__", ".next", ".nuxt"]);

const FRAMEWORK_MARKERS: Array<[string, string]> = [
  ["package.json:react", "React"],
  ["package.json:vue", "Vue"],
  ["package.json:nuxt", "Nuxt"],
  ["package.json:next", "Next.js"],
  ["package.json:express", "Express"],
  ["package.json:fastify", "Fastify"],
  ["requirements.txt:flask", "Flask"],
  ["requirements.txt:django", "Django"],
  ["requirements.txt:fastapi", "FastAPI"],
  ["Cargo.toml:", "Rust/Cargo"],
  ["go.mod:", "Go Modules"],
];

/** SHA-256 prefix of the normalized absolute path — idempotent and reproducible. */
export function generateProjectId(projectPath: string): string {
  const normalized = resolve(projectPath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export interface ProjectScanResult {
  projectId: string;
  projectPath: string;
  projectName: string;
  languages: string[];
  frameworks: string[];
  fileCount: number;
}

export function scanProject(projectPath: string, maxFiles = 5000): ProjectScanResult {
  const normalized = resolve(projectPath);
  const languageCounts = new Map<string, number>();
  const frameworks = new Set<string>();
  let fileCount = 0;

  const walk = (dir: string): void => {
    if (fileCount >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (fileCount >= maxFiles) return;
      if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      } else if (stats.isFile()) {
        fileCount += 1;
        const ext = extname(entry);
        const lang = EXT_LANGUAGE_MAP[ext];
        if (lang) languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
      }
    }
  };
  walk(normalized);

  detectFrameworks(normalized, frameworks);

  const languages = [...languageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);

  return {
    projectId: generateProjectId(normalized),
    projectPath: normalized,
    projectName: normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized,
    languages,
    frameworks: [...frameworks],
    fileCount,
  };
}

function detectFrameworks(projectPath: string, frameworks: Set<string>): void {
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [marker, label] of FRAMEWORK_MARKERS) {
        if (!marker.startsWith("package.json:")) continue;
        const dep = marker.split(":")[1] as string;
        if (Object.keys(deps).some((d) => d.includes(dep))) frameworks.add(label);
      }
    } catch {
      // malformed package.json — skip framework detection from it
    }
  }

  const reqPath = join(projectPath, "requirements.txt");
  if (existsSync(reqPath)) {
    try {
      const content = readFileSync(reqPath, "utf-8").toLowerCase();
      for (const [marker, label] of FRAMEWORK_MARKERS) {
        if (!marker.startsWith("requirements.txt:")) continue;
        const dep = marker.split(":")[1] as string;
        if (content.includes(dep)) frameworks.add(label);
      }
    } catch {
      // unreadable requirements.txt — skip
    }
  }

  if (existsSync(join(projectPath, "Cargo.toml"))) frameworks.add("Rust/Cargo");
  if (existsSync(join(projectPath, "go.mod"))) frameworks.add("Go Modules");
}
