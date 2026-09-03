/** SQLite + FTS5 backed persistence for the context graph. */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EdgeType, NodeType, type GraphEdge, type GraphNode, type SearchResult } from "../types.js";

interface NodeRow {
  id: string;
  node_type: string;
  content: string;
  title: string;
  metadata: string;
  tags: string;
  created_at: string;
  updated_at: string;
  importance_score: number;
  project_id: string;
}

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    nodeType: row.node_type as NodeType,
    content: row.content,
    title: row.title,
    metadata: JSON.parse(row.metadata || "{}"),
    tags: JSON.parse(row.tags || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    importanceScore: row.importance_score,
    projectId: row.project_id,
  };
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  metadata: string;
  created_at: string;
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    edgeType: row.edge_type as EdgeType,
    weight: row.weight,
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
  };
}

/** WAL-mode SQLite graph store with an FTS5 index over node content/title/tags. */
export class GraphStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        importance_score REAL NOT NULL DEFAULT 1.0,
        project_id TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        id UNINDEXED, title, content, tags, content='nodes', content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, id, title, content, tags)
        VALUES (new.rowid, new.id, new.title, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, title, content, tags)
        VALUES ('delete', old.rowid, old.id, old.title, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, title, content, tags)
        VALUES ('delete', old.rowid, old.id, old.title, old.content, old.tags);
        INSERT INTO nodes_fts(rowid, id, title, content, tags)
        VALUES (new.rowid, new.id, new.title, new.content, new.tags);
      END;
    `);
  }

  upsertNode(node: GraphNode): GraphNode {
    this.db
      .prepare(
        `INSERT INTO nodes (id, node_type, content, title, metadata, tags, created_at, updated_at, importance_score, project_id)
         VALUES (@id, @node_type, @content, @title, @metadata, @tags, @created_at, @updated_at, @importance_score, @project_id)
         ON CONFLICT(id) DO UPDATE SET
           content=excluded.content, title=excluded.title, metadata=excluded.metadata,
           tags=excluded.tags, updated_at=excluded.updated_at,
           importance_score=excluded.importance_score, project_id=excluded.project_id`,
      )
      .run({
        id: node.id,
        node_type: node.nodeType,
        content: node.content,
        title: node.title,
        metadata: JSON.stringify(node.metadata),
        tags: JSON.stringify(node.tags),
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        importance_score: node.importanceScore,
        project_id: node.projectId,
      });
    return node;
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  listNodes(options: { nodeType?: NodeType; projectId?: string; limit?: number; offset?: number } = {}): GraphNode[] {
    const { nodeType, projectId, limit = 100, offset = 0 } = options;
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit, offset };
    if (nodeType) {
      clauses.push("node_type = @node_type");
      params.node_type = nodeType;
    }
    if (projectId !== undefined) {
      clauses.push("project_id = @project_id");
      params.project_id = projectId;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM nodes ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all(params) as NodeRow[];
    return rows.map(rowToNode);
  }

  addEdge(edge: GraphEdge): GraphEdge {
    this.db
      .prepare(
        `INSERT INTO edges (id, source_id, target_id, edge_type, weight, metadata, created_at)
         VALUES (@id, @source_id, @target_id, @edge_type, @weight, @metadata, @created_at)`,
      )
      .run({
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        edge_type: edge.edgeType,
        weight: edge.weight,
        metadata: JSON.stringify(edge.metadata),
        created_at: edge.createdAt,
      });
    return edge;
  }

  getEdgesForNode(nodeId: string): GraphEdge[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC")
      .all(nodeId, nodeId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /** Full-text search over node title/content/tags, ranked by FTS5 bm25(). */
  searchFts(query: string, options: { nodeType?: NodeType; projectId?: string; limit?: number } = {}): SearchResult[] {
    const { nodeType, projectId, limit = 20 } = options;
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const clauses = ["nodes_fts MATCH @query"];
    const params: Record<string, unknown> = { query: sanitized, limit };
    if (nodeType) {
      clauses.push("n.node_type = @node_type");
      params.node_type = nodeType;
    }
    if (projectId !== undefined) {
      clauses.push("n.project_id = @project_id");
      params.project_id = projectId;
    }

    const rows = this.db
      .prepare(
        `SELECT n.*, bm25(nodes_fts) AS rank
         FROM nodes_fts
         JOIN nodes n ON n.id = nodes_fts.id
         WHERE ${clauses.join(" AND ")}
         ORDER BY rank LIMIT @limit`,
      )
      .all(params) as (NodeRow & { rank: number })[];

    return rows.map((row) => ({
      node: rowToNode(row),
      // bm25() returns lower-is-better; invert to a friendlier higher-is-better score.
      score: -row.rank,
      matchType: "fts" as const,
      highlights: [],
    }));
  }

  countByType(): Record<string, number> {
    const rows = this.db.prepare("SELECT node_type, COUNT(*) AS c FROM nodes GROUP BY node_type").all() as {
      node_type: string;
      c: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.node_type, r.c]));
  }

  countEdgesByType(): Record<string, number> {
    const rows = this.db.prepare("SELECT edge_type, COUNT(*) AS c FROM edges GROUP BY edge_type").all() as {
      edge_type: string;
      c: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.edge_type, r.c]));
  }

  pruneOlderThan(isoDate: string, options: { keepPinned?: boolean } = {}): number {
    const clause = options.keepPinned
      ? "created_at < ? AND json_extract(metadata, '$.pinned') IS NOT 1"
      : "created_at < ?";
    const result = this.db.prepare(`DELETE FROM nodes WHERE ${clause}`).run(isoDate);
    return result.changes;
  }

  exportAll(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = (this.db.prepare("SELECT * FROM nodes").all() as NodeRow[]).map(rowToNode);
    const edges = (this.db.prepare("SELECT * FROM edges").all() as EdgeRow[]).map(rowToEdge);
    return { nodes, edges };
  }

  close(): void {
    this.db.close();
  }
}

function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/["*^]/g, "").trim())
    .filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
