/** Simple in-memory TTL response cache. */
import { createHash } from "node:crypto";
import { getMetricsCollector } from "../observability/metrics.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResponseCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly metrics = getMetricsCollector();

  constructor(private readonly defaultTtlMs = 5 * 60_000) {}

  static keyFor(agent: string, task: string, context: Record<string, unknown>): string {
    const hash = createHash("sha256");
    hash.update(agent);
    hash.update("::");
    hash.update(task);
    hash.update("::");
    hash.update(JSON.stringify(context, Object.keys(context).sort()));
    return hash.digest("hex");
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.metrics.recordCacheMiss();
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.metrics.recordCacheMiss();
      return undefined;
    }
    this.metrics.recordCacheHit();
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        purged += 1;
      }
    }
    return purged;
  }
}
