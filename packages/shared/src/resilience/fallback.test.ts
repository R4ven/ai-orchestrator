import { describe, it, expect } from "vitest";
import { FallbackManager } from "./fallback.js";
import { makeResponse, type AgentResponse, type BaseAdapter } from "../adapters/base.js";

function stubAdapter(response: AgentResponse | (() => Promise<AgentResponse>)): BaseAdapter {
  return {
    executeTask: async () => (typeof response === "function" ? response() : response),
  } as unknown as BaseAdapter;
}

describe("FallbackManager config parsing", () => {
  it("is disabled when settings.fallback.enabled is not set", () => {
    const manager = new FallbackManager({});
    expect(manager.enabled).toBe(false);
    expect(manager.fallbackMap).toEqual({});
  });

  it("parses the fallback map and enabled flag", () => {
    const manager = new FallbackManager({
      settings: { fallback: { enabled: true, map: { codex: "local-code", claude: "local-instruct" } } },
    });
    expect(manager.enabled).toBe(true);
    expect(manager.resolveFallback("codex")).toBe("local-code");
    expect(manager.resolveFallback("claude")).toBe("local-instruct");
    expect(manager.resolveFallback("unmapped-agent")).toBeUndefined();
  });

  it("prefers an explicit fallback over the configured map", () => {
    const manager = new FallbackManager({ settings: { fallback: { enabled: true, map: { codex: "local-code" } } } });
    expect(manager.resolveFallback("codex", "explicit-agent")).toBe("explicit-agent");
  });
});

describe("FallbackManager.shouldFallback", () => {
  it("returns false when disabled, even for network-looking errors", () => {
    const manager = new FallbackManager({});
    expect(manager.shouldFallback("connection refused")).toBe(false);
  });

  it("detects network/timeout indicators in error text when enabled", () => {
    const manager = new FallbackManager({ settings: { fallback: { enabled: true } } });
    expect(manager.shouldFallback("Connection timed out")).toBe(true);
    expect(manager.shouldFallback("502 Bad Gateway")).toBe(true);
    expect(manager.shouldFallback("Invalid syntax in generated code")).toBe(false);
  });
});

describe("FallbackManager.executeWithFallback", () => {
  it("returns the primary agent's response when it succeeds", async () => {
    const manager = new FallbackManager({ settings: { fallback: { enabled: true, map: { primary: "backup" } } } });
    const adapters = {
      primary: stubAdapter(makeResponse({ success: true, output: "primary output" })),
      backup: stubAdapter(makeResponse({ success: true, output: "backup output" })),
    };

    const { agentUsed, response, fallbackFrom } = await manager.executeWithFallback({
      primaryAgent: "primary",
      adapters,
      task: "do something",
      context: {},
    });

    expect(agentUsed).toBe("primary");
    expect(response.output).toBe("primary output");
    expect(fallbackFrom).toBeUndefined();
  });

  it("falls back when the primary agent returns a recoverable error", async () => {
    const manager = new FallbackManager({ settings: { fallback: { enabled: true, map: { primary: "backup" } } } });
    const adapters = {
      primary: stubAdapter(makeResponse({ success: false, output: "", error: "Connection timed out" })),
      backup: stubAdapter(makeResponse({ success: true, output: "backup output" })),
    };

    const { agentUsed, response, fallbackFrom } = await manager.executeWithFallback({
      primaryAgent: "primary",
      adapters,
      task: "do something",
      context: {},
    });

    expect(agentUsed).toBe("backup");
    expect(response.output).toBe("backup output");
    expect(fallbackFrom).toBe("primary");
  });

  it("does not fall back on a non-recoverable error", async () => {
    const manager = new FallbackManager({ settings: { fallback: { enabled: true, map: { primary: "backup" } } } });
    const adapters = {
      primary: stubAdapter(makeResponse({ success: false, output: "", error: "Invalid syntax" })),
      backup: stubAdapter(makeResponse({ success: true, output: "backup output" })),
    };

    const { agentUsed, response, fallbackFrom } = await manager.executeWithFallback({
      primaryAgent: "primary",
      adapters,
      task: "do something",
      context: {},
    });

    expect(agentUsed).toBe("primary");
    expect(response.success).toBe(false);
    expect(fallbackFrom).toBeUndefined();
  });

  it("reports a clear error when the primary agent is not in the adapter map", async () => {
    const manager = new FallbackManager({});
    const { agentUsed, response } = await manager.executeWithFallback({
      primaryAgent: "missing",
      adapters: {},
      task: "do something",
      context: {},
    });
    expect(agentUsed).toBe("missing");
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/not found/);
  });
});
