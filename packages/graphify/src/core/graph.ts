/** SQLite + FTS5 backed project graph store. */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EdgeProvenance, EdgeType, NodeType, type GraphEdge, type GraphNode } from "./schema.js";

interface NodeRow {
  id: string;
  node_type: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  line_start: number;
  line_end: number;
  content: string;
  metadata: string;
  project_id: string;
  created_at: number;
}

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    nodeType: row.node_type as NodeType,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    content: row.content,
    metadata: JSON.parse(row.metadata || "{}"),
    projectId: row.project_id,
    createdAt: row.created_at,
  };
}

interface EdgeRow {
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  confidence: number;
  provenance: string;
  metadata: string;
  project_id: string;
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    sourceId: row.source_id,
    targetId: row.target_id,
    edgeType: row.edge_type as EdgeType,
    weight: row.weight,
    confidence: row.confidence,
    provenance: row.provenance as EdgeProvenance,
    metadata: JSON.parse(row.metadata || "{}"),
    projectId: row.project_id,
  };
}

export class GraphStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        qualified_name TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        line_start INTEGER NOT NULL DEFAULT 0,
        line_end INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        project_id TEXT NOT NULL DEFAULT '',
        created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 1.0,
        provenance TEXT NOT NULL DEFAULT 'EXTRACTED',
        metadata TEXT NOT NULL DEFAULT '{}',
        project_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (source_id, target_id, edge_type)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        id UNINDEXED, name, qualified_name, content, content='nodes', content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, content)
        VALUES (new.rowid, new.id, new.name, new.qualified_name, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, content)
        VALUES ('delete', old.rowid, old.id, old.name, old.qualified_name, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, content)
        VALUES ('delete', old.rowid, old.id, old.name, old.qualified_name, old.content);
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, content)
        VALUES (new.rowid, new.id, new.name, new.qualified_name, new.content);
      END;
    `);
  }

  upsertNode(node: GraphNode): GraphNode {
    this.db
      .prepare(
        `INSERT INTO nodes (id, node_type, name, qualified_name, file_path, language, line_start, line_end, content, metadata, project_id, created_at)
         VALUES (@id, @node_type, @name, @qualified_name, @file_path, @language, @line_start, @line_end, @content, @metadata, @project_id, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, qualified_name=excluded.qualified_name, file_path=excluded.file_path,
           language=excluded.language, line_start=excluded.line_start, line_end=excluded.line_end,
           content=excluded.content, metadata=excluded.metadata`,
      )
      .run({
        id: node.id,
        node_type: node.nodeType,
        name: node.name,
        qualified_name: node.qualifiedName,
        file_path: node.filePath,
        language: node.language,
        line_start: node.lineStart,
        line_end: node.lineEnd,
        content: node.content,
        metadata: JSON.stringify(node.metadata),
        project_id: node.projectId,
        created_at: node.createdAt,
      });
    return node;
  }

  addEdge(edge: GraphEdge): void {
    this.db
      .prepare(
        `INSERT INTO edges (source_id, target_id, edge_type, weight, confidence, provenance, metadata, project_id)
         VALUES (@source_id, @target_id, @edge_type, @weight, @confidence, @provenance, @metadata, @project_id)
         ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET weight=excluded.weight`,
      )
      .run({
        source_id: edge.sourceId,
        target_id: edge.targetId,
        edge_type: edge.edgeType,
        weight: edge.weight,
        confidence: edge.confidence,
        provenance: edge.provenance,
        metadata: JSON.stringify(edge.metadata),
        project_id: edge.projectId,
      });
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  findNodeByQualifiedName(qualifiedName: string, projectId: string): GraphNode | null {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE qualified_name = ? AND project_id = ? LIMIT 1")
      .get(qualifiedName, projectId) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  listNodes(options: { nodeType?: NodeType; projectId?: string; filePath?: string; limit?: number } = {}): GraphNode[] {
    const { nodeType, projectId, filePath, limit = 1000 } = options;
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (nodeType) {
      clauses.push("node_type = @node_type");
      params.node_type = nodeType;
    }
    if (projectId !== undefined) {
      clauses.push("project_id = @project_id");
      params.project_id = projectId;
    }
    if (filePath !== undefined) {
      clauses.push("file_path = @file_path");
      params.file_path = filePath;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM nodes ${where} LIMIT @limit`).all(params) as NodeRow[];
    return rows.map(rowToNode);
  }

  edgesFrom(nodeId: string): GraphEdge[] {
    return (this.db.prepare("SELECT * FROM edges WHERE source_id = ?").all(nodeId) as EdgeRow[]).map(rowToEdge);
  }

  edgesTo(nodeId: string): GraphEdge[] {
    return (this.db.prepare("SELECT * FROM edges WHERE target_id = ?").all(nodeId) as EdgeRow[]).map(rowToEdge);
  }

  search(query: string, options: { projectId?: string; nodeType?: NodeType; limit?: number } = {}): Array<{ node: GraphNode; score: number }> {
    const { projectId, nodeType, limit = 25 } = options;
    const sanitized = query
      .split(/\s+/)
      .map((t) => t.replace(/["*^]/g, "").trim())
      .filter(Boolean)
      .map((t) => `"${t}"*`)
      .join(" OR ");
    if (!sanitized) return [];

    const clauses = ["nodes_fts MATCH @query"];
    const params: Record<string, unknown> = { query: sanitized, limit };
    if (projectId !== undefined) {
      clauses.push("n.project_id = @project_id");
      params.project_id = projectId;
    }
    if (nodeType) {
      clauses.push("n.node_type = @node_type");
      params.node_type = nodeType;
    }

    const rows = this.db
      .prepare(
        `SELECT n.*, bm25(nodes_fts) AS rank FROM nodes_fts JOIN nodes n ON n.id = nodes_fts.id
         WHERE ${clauses.join(" AND ")} ORDER BY rank LIMIT @limit`,
      )
      .all(params) as (NodeRow & { rank: number })[];

    return rows.map((row) => ({ node: rowToNode(row), score: -row.rank }));
  }

  /** BFS shortest path between two node IDs (undirected traversal over CONTAINS/IMPORTS/CALLS edges). */
  findPath(startId: string, endId: string, maxDepth = 6): GraphNode[] | null {
    if (startId === endId) {
      const node = this.getNode(startId);
      return node ? [node] : null;
    }

    const visited = new Set<string>([startId]);
    const parent = new Map<string, string>();
    let frontier = [startId];

    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const neighbors = [...this.edgesFrom(nodeId).map((e) => e.targetId), ...this.edgesTo(nodeId).map((e) => e.sourceId)];
        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          parent.set(neighbor, nodeId);
          if (neighbor === endId) {
            const path = [endId];
            let cur = endId;
            while (parent.has(cur)) {
              cur = parent.get(cur) as string;
              path.unshift(cur);
            }
            return path.map((id) => this.getNode(id)).filter((n): n is GraphNode => n !== null);
          }
          nextFrontier.push(neighbor);
        }
      }
      frontier = nextFrontier;
    }
    return null;
  }

  countByType(projectId?: string): Record<string, number> {
    const rows = projectId
      ? (this.db.prepare("SELECT node_type, COUNT(*) AS c FROM nodes WHERE project_id = ? GROUP BY node_type").all(projectId) as { node_type: string; c: number }[])
      : (this.db.prepare("SELECT node_type, COUNT(*) AS c FROM nodes GROUP BY node_type").all() as { node_type: string; c: number }[]);
    return Object.fromEntries(rows.map((r) => [r.node_type, r.c]));
  }

  /** "God node" analysis: nodes with the most incident edges (candidates for refactoring). */
  mostConnectedNodes(limit = 10): Array<{ node: GraphNode; degree: number }> {
    const rows = this.db
      .prepare(
        `SELECT n.*, (
           (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id) +
           (SELECT COUNT(*) FROM edges e WHERE e.target_id = n.id)
         ) AS degree
         FROM nodes n ORDER BY degree DESC LIMIT ?`,
      )
      .all(limit) as (NodeRow & { degree: number })[];
    return rows.map((row) => ({ node: rowToNode(row), degree: row.degree }));
  }

  deleteProject(projectId: string): number {
    const result = this.db.prepare("DELETE FROM nodes WHERE project_id = ?").run(projectId);
    return result.changes;
  }

  exportAll(projectId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = this.listNodes({ projectId, limit: 1_000_000 });
    const edgeRows = projectId
      ? (this.db.prepare("SELECT * FROM edges WHERE project_id = ?").all(projectId) as EdgeRow[])
      : (this.db.prepare("SELECT * FROM edges").all() as EdgeRow[]);
    return { nodes, edges: edgeRows.map(rowToEdge) };
  }

  close(): void {
    this.db.close();
  }
}
