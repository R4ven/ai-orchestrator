/** Resolves where a project's Graphify database lives. */
import { resolve, join } from "node:path";

export interface GraphifyConfigOptions {
  dbPath?: string;
}

export class GraphifyConfig {
  constructor(private readonly options: GraphifyConfigOptions = {}) {}

  /** Default: `<project>/.graphify/graph.db`, overridable via `dbPath`. */
  resolveDbPath(projectPath: string): string {
    if (this.options.dbPath) return resolve(this.options.dbPath);
    return join(resolve(projectPath), ".graphify", "graph.db");
  }
}
