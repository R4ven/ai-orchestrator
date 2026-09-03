/** Adapter for llama.cpp / OpenAI-compatible local model servers. */
import { AgentCapability, BaseAdapter, makeResponse, type AgentConfig, type AgentResponse } from "./base.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class LlamaCppAdapter extends BaseAdapter {
  readonly model?: string;
  readonly modelPath?: string;
  readonly maxTokens: number;
  readonly temperature: number;

  constructor(config: AgentConfig) {
    super({ offline: true, ...config });
    this.endpoint = String(config.endpoint ?? "http://localhost:8080").replace(/\/$/, "");
    this.model = config.model as string | undefined;
    this.modelPath = config.model_path as string | undefined;
    const maxTokens = Number(config.max_tokens ?? 4096);
    this.maxTokens = Number.isFinite(maxTokens) ? Math.max(1, maxTokens) : 4096;
    const temperature = Number(config.temperature ?? 0.7);
    this.temperature = Number.isFinite(temperature) ? clamp(temperature, 0, 2) : 0.7;
    const timeout = Number(config.timeout ?? 3600);
    this.timeout = Number.isFinite(timeout) ? Math.max(1, timeout) : 3600;
  }

  getCapabilities(): AgentCapability[] {
    return [
      AgentCapability.IMPLEMENTATION,
      AgentCapability.CODE_REVIEW,
      AgentCapability.REFACTORING,
      AgentCapability.TESTING,
      AgentCapability.DOCUMENTATION,
    ];
  }

  private buildPayload(task: string, context: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      prompt: this.buildLocalLlmPrompt(task, context),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stop: ["```\n\n", "Human:", "User:"],
    };
    if (this.model) payload.model = this.model;
    return payload;
  }

  private parseTextResponse(data: unknown): string {
    if (typeof data !== "object" || data === null) return "";
    const choices = (data as Record<string, unknown>).choices;
    if (!Array.isArray(choices) || choices.length === 0) return "";
    const first = choices[0];
    if (typeof first !== "object" || first === null) return first ? String(first) : "";
    return String((first as Record<string, unknown>).text ?? "");
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const payload = this.buildPayload(task, context);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout * 1000);
      const res = await fetch(`${this.endpoint}/v1/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return makeResponse({ success: false, output: "", error: `HTTP error: ${res.status} ${res.statusText}` });
      }
      const data = await res.json();
      return makeResponse({
        success: true,
        output: this.parseTextResponse(data),
        metadata: { model: this.model ?? "default" },
      });
    } catch (e) {
      return makeResponse({ success: false, output: "", error: `Connection error: ${e}` });
    }
  }

  async healthCheck(): Promise<boolean> {
    const checks: Array<[string, Set<number>]> = [
      [`${this.endpoint}/health`, new Set([200])],
      [`${this.endpoint}/v1/models`, new Set([200])],
      [this.endpoint, new Set([200, 301, 302, 404])],
    ];
    for (const [url, okCodes] of checks) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(url, { redirect: "manual", signal: controller.signal });
        clearTimeout(timer);
        if (okCodes.has(res.status)) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  isAvailable(): boolean {
    return this.enabled;
  }

  override async checkAvailability(): Promise<boolean> {
    return this.enabled && (await this.healthCheck());
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.endpoint}/v1/models`);
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    } catch {
      return [];
    }
  }
}
