import { describe, it, expect, vi } from "vitest";
import { retryOnError, CircuitBreaker, CircuitState, RateLimiter } from "./retry.js";

describe("retryOnError", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryOnError(fn, { maxAttempts: 3, waitSeconds: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries until success within maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const result = await retryOnError(fn, { maxAttempts: 3, waitSeconds: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(retryOnError(fn, { maxAttempts: 2, waitSeconds: 0 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry errors outside retryableErrors", async () => {
    class SpecificError extends Error {}
    class OtherError extends Error {}
    const fn = vi.fn().mockRejectedValue(new OtherError("nope"));
    await expect(retryOnError(fn, { maxAttempts: 3, waitSeconds: 0, retryableErrors: [SpecificError] })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker", () => {
  it("stays closed while under the failure threshold", async () => {
    const breaker = new CircuitBreaker(3, 60_000);
    const failing = () => Promise.reject(new Error("fail"));

    await expect(breaker.call(failing)).rejects.toThrow();
    await expect(breaker.call(failing)).rejects.toThrow();
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });

  it("opens after reaching the failure threshold and rejects further calls", async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    const failing = () => Promise.reject(new Error("fail"));

    await expect(breaker.call(failing)).rejects.toThrow();
    await expect(breaker.call(failing)).rejects.toThrow();
    expect(breaker.state).toBe(CircuitState.OPEN);

    // Circuit is open: the next call should be rejected by the breaker itself,
    // without invoking the underlying function.
    const spy = vi.fn().mockResolvedValue("should not run");
    await expect(breaker.call(spy)).rejects.toThrow(/Circuit breaker is OPEN/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resets to closed after a success", async () => {
    const breaker = new CircuitBreaker(5, 60_000);
    await expect(breaker.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    await breaker.call(() => Promise.resolve("ok"));
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });
});

describe("RateLimiter", () => {
  it("allows up to capacity immediately, then denies", () => {
    const limiter = new RateLimiter(1, 3);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(false);
  });
});
