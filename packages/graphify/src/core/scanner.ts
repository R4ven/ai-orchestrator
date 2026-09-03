/** Walks a project directory, builds FILE/DIRECTORY nodes, and dispatches to analyzers. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { getLogger } from "@ai-orchestrator/shared";
import { classifyLanguage, EdgeType, generateProjectId, Language, NodeType, createGraphEdge, createGraphNode, type ProjectSummary } from "./schema.js";
import { GraphStore } from "./graph.js";
import { defaultAnalyzers, type Analyzer } from "../analyzers/index.js";

const logger = getLogger("graphify.scanner");

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", "venv", ".venv", ".next", ".nuxt", "coverage"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ScanOptions {
  maxFiles?: number;
  analyzers?: Analyzer[];
}

export class Scanner {
  private readonly analyzers: Analyzer[];
  readonly projectId: string;

  constructor(
    private readonly rootPath: string,
    private readonly store: GraphStore,
    private readonly options: ScanOptions = {},
  ) {
    this.analyzers = options.analyzers ?? defaultAnalyzers();
    this.projectId = generateProjectId(rootPath);
  }

  scan(): ProjectSummary {
    const maxFiles = this.options.maxFiles ?? 20_000;
    const projectNode = createGraphNode({
      id: this.projectId,
      nodeType: NodeType.PROJECT,
      name: basename(this.rootPath),
      qualifiedName: this.rootPath,
      filePath: this.rootPath,
      projectId: this.projectId,
    });
    this.store.upsertNode(projectNode);

    const summary: ProjectSummary = {
      projectId: this.projectId,
      rootPath: this.rootPath,
      name: projectNode.name,
      languages: {},
      totalFiles: 0,
      totalLines: 0,
      totalClasses: 0,
      totalFunctions: 0,
      totalTests: 0,
      dependencies: [],
      frameworks: [],
      scannedAt: Date.now() / 1000,
    };

    let fileCount = 0;
    const walk = (dir: string, parentNodeId: string): void => {
      if (fileCount >= maxFiles) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch (e) {
        logger.warning(`Failed to read directory ${dir}: ${e}`);
        return;
      }

      for (const entry of entries) {
        if (fileCount >= maxFiles) return;
        if (entry.startsWith(".") && entry !== ".env" && entry !== ".env.example") continue;
        if (IGNORED_DIRS.has(entry)) continue;

        const full = join(dir, entry);
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          const dirNode = createGraphNode({
            nodeType: NodeType.DIRECTORY,
            name: entry,
            qualifiedName: relative(this.rootPath, full),
            filePath: full,
            projectId: this.projectId,
          });
          this.store.upsertNode(dirNode);
          this.store.addEdge(createGraphEdge({ sourceId: parentNodeId, targetId: dirNode.id, edgeType: EdgeType.CONTAINS, projectId: this.projectId }));
          walk(full, dirNode.id);
          continue;
        }

        if (!stats.isFile() || stats.size > MAX_FILE_BYTES) continue;
        fileCount += 1;

        const relPath = relative(this.rootPath, full);
        const language = classifyLanguage(full);
        const fileNode = createGraphNode({
          nodeType: NodeType.FILE,
          name: entry,
          qualifiedName: relPath,
          filePath: relPath,
          language,
          projectId: this.projectId,
        });
        this.store.upsertNode(fileNode);
        this.store.addEdge(createGraphEdge({ sourceId: parentNodeId, targetId: fileNode.id, edgeType: EdgeType.CONTAINS, projectId: this.projectId }));

        summary.totalFiles += 1;
        summary.languages[language] = (summary.languages[language] ?? 0) + 1;

        if (language === Language.UNKNOWN) continue;

        let content: string;
        try {
          content = readFileSync(full, "utf-8");
        } catch {
          continue;
        }
        summary.totalLines += content.split("\n").length;

        const analyzer = this.analyzers.find((a) => a.supports(language));
        if (!analyzer) continue;

        try {
          const result = analyzer.analyze({
            filePath: relPath,
            relativePath: relPath,
            content,
            language,
            projectId: this.projectId,
            fileNodeId: fileNode.id,
          });
          for (const node of result.nodes) {
            this.store.upsertNode(node);
            if (node.nodeType === NodeType.CLASS) summary.totalClasses += 1;
            if (node.nodeType === NodeType.FUNCTION) summary.totalFunctions += 1;
            if (node.nodeType === NodeType.TEST) summary.totalTests += 1;
          }
          for (const edge of result.edges) this.store.addEdge(edge);
        } catch (e) {
          logger.debug(`Analyzer failed for ${relPath}: ${e}`);
        }
      }
    };

    walk(this.rootPath, this.projectId);
    logger.info(`Scanned ${summary.totalFiles} files in ${this.rootPath}`);
    return summary;
  }
}
