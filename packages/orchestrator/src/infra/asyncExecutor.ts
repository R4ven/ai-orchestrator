/** Bounded-concurrency async task execution helper. */

export class AsyncExecutor {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency = 4) {}

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Run tasks with bounded concurrency, preserving result order. */
  async map<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    await Promise.all(
      items.map((item, index) =>
        this.run(async () => {
          results[index] = await fn(item, index);
        }),
      ),
    );
    return results;
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = "Operation timed out"): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
