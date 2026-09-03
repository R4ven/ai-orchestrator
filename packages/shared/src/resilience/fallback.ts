/** Cloud-to-local fallback execution manager. */
import type { Logger } from "../logger.js";
import { getLogger } from "../logger.js";
import { makeResponse, type AgentResponse, type BaseAdapter } from "../adapters/base.js";

export interface FallbackSettings {
  fallback?: {
    enabled?: boolean;
    map?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface FallbackConfig {
  settings?: FallbackSettings;
}

export class FallbackManager {
  private readonly logger: Logger;
  readonly enabled: boolean;
  readonly fallbackMap: Record<string, string>;

  constructor(config: FallbackConfig, logger?: Logger) {
    this.logger = logger ?? getLogger("orchestrator.fallback");
    const [enabled, map] = this.parseFallbackConfig(config);
    this.enabled = enabled;
    this.fallbackMap = map;
  }

  private parseFallbackConfig(config: FallbackConfig): [boolean, Record<string, string>] {
    const fallbackConfig = config.settings?.fallback;
    if (!fallbackConfig || typeof fallbackConfig !== "object") return [false, {}];

    const enabled = Boolean(fallbackConfig.enabled);
    const mapping: Record<string, string> = {};

    if (fallbackConfig.map && typeof fallbackConfig.map === "object") {
      for (const [k, v] of Object.entries(fallbackConfig.map)) mapping[k] = String(v);
    }
    for (const [key, value] of Object.entries(fallbackConfig)) {
      if (key === "enabled" || key === "map") continue;
      if (typeof value === "string") mapping[key] = value;
    }

    return [enabled, mapping];
  }

  resolveFallback(primaryAgent: string, explicitFallback?: string): string | undefined {
    if (explicitFallback) return explicitFallback;
    return this.fallbackMap[primaryAgent];
  }

  shouldFallback(error?: string, exception?: unknown): boolean {
    if (!this.enabled) return false;

    if (exception !== undefined) {
      if (isNetworkError(exception)) return true;
      const status = extractStatusCode(exception);
      if (status !== undefined) return status >= 500;
    }

    if (!error) return false;
    const message = error.toLowerCase();
    const indicators = [
      "connection",
      "network",
      "timed out",
      "timeout",
      "temporary failure",
      "dns",
      "unreachable",
      "api error",
      "http error",
      "503",
      "502",
      "504",
    ];
    return indicators.some((token) => message.includes(token));
  }

  async executeWithFallback(params: {
    primaryAgent: string;
    adapters: Record<string, BaseAdapter>;
    task: string;
    context: Record<string, unknown>;
    explicitFallback?: string;
  }): Promise<{ agentUsed: string; response: AgentResponse; fallbackFrom?: string }> {
    const { primaryAgent, adapters, task, context, explicitFallback } = params;

    if (!(primaryAgent in adapters)) {
      return {
        agentUsed: primaryAgent,
        response: makeResponse({
          success: false,
          output: "",
          error: `Primary agent '${primaryAgent}' not found in available adapters`,
        }),
      };
    }

    const primaryAdapter = adapters[primaryAgent] as BaseAdapter;
    const fallbackAgent = this.resolveFallback(primaryAgent, explicitFallback);

    let response: AgentResponse;
    try {
      response = await primaryAdapter.executeTask(task, context);
    } catch (exc) {
      if (!fallbackAgent || !(fallbackAgent in adapters) || !this.shouldFallback(undefined, exc)) {
        return { agentUsed: primaryAgent, response: makeResponse({ success: false, output: "", error: String(exc) }) };
      }
      this.logger.warning(`Primary agent '${primaryAgent}' failed (${exc}), falling back to '${fallbackAgent}'`);
      return this.runFallback(primaryAgent, fallbackAgent, adapters, task, context, String(exc));
    }

    if (response.success) return { agentUsed: primaryAgent, response };

    if (!fallbackAgent || !(fallbackAgent in adapters) || !this.shouldFallback(response.error)) {
      return { agentUsed: primaryAgent, response };
    }

    this.logger.warning(
      `Primary agent '${primaryAgent}' returned recoverable error (${response.error}), falling back to '${fallbackAgent}'`,
    );
    return this.runFallback(primaryAgent, fallbackAgent, adapters, task, context, response.error ?? "unknown error");
  }

  private async runFallback(
    primaryAgent: string,
    fallbackAgent: string,
    adapters: Record<string, BaseAdapter>,
    task: string,
    context: Record<string, unknown>,
    primaryError: string,
  ): Promise<{ agentUsed: string; response: AgentResponse; fallbackFrom?: string }> {
    try {
      const fallbackResponse = await (adapters[fallbackAgent] as BaseAdapter).executeTask(task, context);
      return { agentUsed: fallbackAgent, response: fallbackResponse, fallbackFrom: primaryAgent };
    } catch (fallbackExc) {
      return {
        agentUsed: primaryAgent,
        response: makeResponse({
          success: false,
          output: "",
          error: `Primary failed: ${primaryError}; fallback '${fallbackAgent}' failed: ${fallbackExc}`,
        }),
      };
    }
  }
}

function isNetworkError(exception: unknown): boolean {
  if (exception instanceof Error) {
    const name = exception.name;
    return (
      name === "AbortError" ||
      name === "TypeError" /* fetch network failure */ ||
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/.test(exception.message)
    );
  }
  return false;
}

function extractStatusCode(exception: unknown): number | undefined {
  if (exception && typeof exception === "object" && "status" in exception) {
    const status = (exception as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
