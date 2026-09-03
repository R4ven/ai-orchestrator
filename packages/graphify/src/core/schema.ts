/** Graph schema — node types, edge types, and data models. */
import { createHash, randomBytes } from "node:crypto";
import { basename, extname, resolve } from "node:path";

export enum NodeType {
  PROJECT = "PROJECT",
  DIRECTORY = "DIRECTORY",
  FILE = "FILE",
  MODULE = "MODULE",
  CLASS = "CLASS",
  FUNCTION = "FUNCTION",
  IMPORT = "IMPORT",
  DEPENDENCY = "DEPENDENCY",
  CONFIG = "CONFIG",
  DOCUMENTATION = "DOCUMENTATION",
  TEST = "TEST",
  VARIABLE = "VARIABLE",
}

export enum EdgeType {
  CONTAINS = "CONTAINS",
  IMPORTS = "IMPORTS",
  INHERITS = "INHERITS",
  CALLS = "CALLS",
  DEPENDS_ON = "DEPENDS_ON",
  TESTS = "TESTS",
  DOCUMENTS = "DOCUMENTS",
  CONFIGURED_BY = "CONFIGURED_BY",
  EXPORTS = "EXPORTS",
  MEMBER_OF = "MEMBER_OF",
}

export enum EdgeProvenance {
  EXTRACTED = "EXTRACTED",
  INFERRED = "INFERRED",
  AMBIGUOUS = "AMBIGUOUS",
}

export enum Language {
  PYTHON = "python",
  JAVASCRIPT = "javascript",
  TYPESCRIPT = "typescript",
  JAVA = "java",
  GO = "go",
  RUST = "rust",
  RUBY = "ruby",
  CPP = "cpp",
  C = "c",
  CSHARP = "csharp",
  SWIFT = "swift",
  KOTLIN = "kotlin",
  PHP = "php",
  SHELL = "shell",
  SQL = "sql",
  HTML = "html",
  CSS = "css",
  YAML = "yaml",
  JSON = "json",
  TOML = "toml",
  MARKDOWN = "markdown",
  DOCKERFILE = "dockerfile",
  UNKNOWN = "unknown",
}

export const EXTENSION_LANGUAGE_MAP: Record<string, Language> = {
  ".py": Language.PYTHON,
  ".pyw": Language.PYTHON,
  ".pyi": Language.PYTHON,
  ".js": Language.JAVASCRIPT,
  ".jsx": Language.JAVASCRIPT,
  ".mjs": Language.JAVASCRIPT,
  ".cjs": Language.JAVASCRIPT,
  ".ts": Language.TYPESCRIPT,
  ".tsx": Language.TYPESCRIPT,
  ".java": Language.JAVA,
  ".go": Language.GO,
  ".rs": Language.RUST,
  ".rb": Language.RUBY,
  ".cpp": Language.CPP,
  ".cxx": Language.CPP,
  ".cc": Language.CPP,
  ".hpp": Language.CPP,
  ".c": Language.C,
  ".h": Language.C,
  ".cs": Language.CSHARP,
  ".swift": Language.SWIFT,
  ".kt": Language.KOTLIN,
  ".kts": Language.KOTLIN,
  ".php": Language.PHP,
  ".sh": Language.SHELL,
  ".bash": Language.SHELL,
  ".zsh": Language.SHELL,
  ".sql": Language.SQL,
  ".html": Language.HTML,
  ".htm": Language.HTML,
  ".css": Language.CSS,
  ".scss": Language.CSS,
  ".less": Language.CSS,
  ".yaml": Language.YAML,
  ".yml": Language.YAML,
  ".json": Language.JSON,
  ".toml": Language.TOML,
  ".md": Language.MARKDOWN,
  ".mdx": Language.MARKDOWN,
  ".rst": Language.MARKDOWN,
};

export const FILENAME_LANGUAGE_MAP: Record<string, Language> = {
  Dockerfile: Language.DOCKERFILE,
  Makefile: Language.SHELL,
  Jenkinsfile: Language.UNKNOWN,
  ".env": Language.SHELL,
  ".env.example": Language.SHELL,
};

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  metadata: Record<string, unknown>;
  projectId: string;
  createdAt: number;
}

export function createGraphNode(partial: Partial<GraphNode> & { nodeType: NodeType }): GraphNode {
  return {
    id: randomBytes(8).toString("hex"),
    name: "",
    qualifiedName: "",
    filePath: "",
    language: "",
    lineStart: 0,
    lineEnd: 0,
    content: "",
    metadata: {},
    projectId: "",
    createdAt: Date.now() / 1000,
    ...partial,
  };
}

export function searchableText(node: GraphNode): string {
  const parts = [node.name, node.qualifiedName, node.content];
  for (const v of Object.values(node.metadata)) if (typeof v === "string") parts.push(v);
  return parts.filter(Boolean).join(" ");
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  edgeType: EdgeType;
  weight: number;
  confidence: number;
  provenance: EdgeProvenance;
  metadata: Record<string, unknown>;
  projectId: string;
}

export function createGraphEdge(partial: Partial<GraphEdge> & { sourceId: string; targetId: string }): GraphEdge {
  return {
    edgeType: EdgeType.CONTAINS,
    weight: 1.0,
    confidence: 1.0,
    provenance: EdgeProvenance.EXTRACTED,
    metadata: {},
    projectId: "",
    ...partial,
  };
}

export interface ProjectSummary {
  projectId: string;
  rootPath: string;
  name: string;
  languages: Record<string, number>;
  totalFiles: number;
  totalLines: number;
  totalClasses: number;
  totalFunctions: number;
  totalTests: number;
  dependencies: string[];
  frameworks: string[];
  scannedAt: number;
}

/** Deterministic project ID from absolute path (SHA-256 prefix). */
export function generateProjectId(path: string): string {
  const normalized = resolve(path);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function classifyLanguage(filePath: string): Language {
  const name = basename(filePath);
  if (name in FILENAME_LANGUAGE_MAP) return FILENAME_LANGUAGE_MAP[name] as Language;
  const ext = extname(name).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? Language.UNKNOWN;
}
