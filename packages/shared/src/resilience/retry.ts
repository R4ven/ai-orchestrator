/** Retry logic and resilience patterns for the orchestrator. */
import { getLogger } from "../logger.js";
import { AgentExecutionError, AgentTimeoutError } from "../exceptions.js";

const logger = getLogger("resilience.retry");

export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export interface RetryOptions {
  maxAttempts?: number;
  waitSeconds?: number;
  exponentialBackoff?: boolean;
  retryableErrors?: Array<new (...args: never[]) => Error>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry an async function on error, with exponential (or fixed) backoff. */
export async function retryOnError<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    waitSeconds = 1.0,
    exponentialBackoff = true,
    retryableErrors,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable =
        !retryableErrors || retryableErrors.some((ErrClass) => error instanceof ErrClass);
      if (!retryable || attempt === maxAttempts) throw error;

      const wait = exponentialBackoff
        ? Math.min(60, waitSeconds * 2 ** (attempt - 1))
        : waitSeconds;
      logger.warning(`Retry attempt ${attempt}/${maxAttempts} after ${wait}s`, { error: String(error) });
      await sleep(wait * 1000);
    }
  }
  throw lastError;
}

/** Specialized retry for agent execution errors. */
export async function retryAgentExecution<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  waitSeconds = 2.0,
): Promise<T> {
  return retryOnError(fn, {
    maxAttempts,
    waitSeconds,
    exponentialBackoff: true,
    retryableErrors: [AgentExecutionError, AgentTimeoutError],
  });
}

/** Circuit breaker pattern: stops calling a service that is likely to fail. */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  state: CircuitState = CircuitState.CLOSED;

  constructor(
    private readonly failureThreshold = 5,
    private readonly recoveryTimeoutMs = 60_000,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        const waitRemaining = this.recoveryTimeoutMs - (Date.now() - (this.lastFailureTime ?? 0));
        throw new Error(
          `Circuit breaker is OPEN after ${this.failureCount} failures. ` +
            `Retry in ${Math.max(0, waitRemaining / 1000).toFixed(1)}s ` +
            `(recovery timeout: ${this.recoveryTimeoutMs / 1000}s)`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  private shouldAttemptReset(): boolean {
    if (this.lastFailureTime === null) return true;
    return Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs;
  }

  private onSuccess(): void {
    const prevState = this.state;
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
    if (prevState !== CircuitState.CLOSED) logger.info(`Circuit breaker: Reset to CLOSED (was ${prevState})`);
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.error(
        `Circuit breaker OPEN: ${this.failureCount}/${this.failureThreshold} failures reached threshold. ` +
          `Recovery in ${this.recoveryTimeoutMs / 1000}s.`,
      );
    }
  }
}

/** Token bucket rate limiter. */
export class RateLimiter {
  private tokens: number;
  private lastUpdate = Date.now();

  constructor(
    private readonly rate: number,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
  }

  acquire(tokens = 1): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastUpdate) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.rate);
    this.lastUpdate = now;

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  async wait(tokens = 1): Promise<void> {
    while (!this.acquire(tokens)) {
      await sleep(100);
    }
  }
}
