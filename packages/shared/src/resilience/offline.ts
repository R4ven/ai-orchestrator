/** Offline mode detection with cached connectivity checks. */

export interface OfflineDetectorOptions {
  checkIntervalSeconds?: number;
  connectivityUrl?: string;
  timeoutMs?: number;
}

export class OfflineDetector {
  private readonly checkIntervalMs: number;
  private readonly connectivityUrl: string;
  private readonly timeoutMs: number;
  private cachedOffline: boolean | null = null;
  private lastCheckMs = 0;

  constructor(options: OfflineDetectorOptions = {}) {
    this.checkIntervalMs = (options.checkIntervalSeconds ?? 60) * 1000;
    this.connectivityUrl =
      options.connectivityUrl ?? process.env.CONNECTIVITY_CHECK_URL ?? "https://httpbin.org/status/200";
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async isOffline(forceRefresh = false): Promise<boolean> {
    const now = Date.now();
    const cacheIsFresh = now - this.lastCheckMs < this.checkIntervalMs;

    if (forceRefresh || this.cachedOffline === null || !cacheIsFresh) {
      this.cachedOffline = !(await this.checkConnectivity());
      this.lastCheckMs = now;
    }

    return this.cachedOffline;
  }

  private async checkConnectivity(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(this.connectivityUrl, { method: "HEAD", redirect: "follow", signal: controller.signal });
      clearTimeout(timer);
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}
