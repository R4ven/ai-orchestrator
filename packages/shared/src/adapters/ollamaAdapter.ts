/** Adapter for the Ollama local model server. */
import { AgentCapability, BaseAdapter, makeResponse, type AgentConfig, type AgentResponse } from "./base.js";

const CAPABILITY_MAP: Record<string, AgentCapability> = {
  code: AgentCapability.IMPLEMENTATION,
  review: AgentCapability.CODE_REVIEW,
  docs: AgentCapability.DOCUMENTATION,
  general: AgentCapability.DOCUMENTATION,
  test: AgentCapability.TESTING,
  refactor: AgentCapability.REFACTORING,
};

export class OllamaAdapter extends BaseAdapter {
  readonly model: string;
  readonly keepAlive: string;

  constructor(config: AgentConfig) {
    super({ offline: true, ...config });
    this.model = (config.model as string) ?? "codellama:13b";
    this.endpoint = String(config.endpoint ?? "http://localhost:11434").replace(/\/$/, "");
    this.timeout = Number(config.timeout ?? 3600);
    this.keepAlive = (config.keep_alive as string) ?? "5m";
  }

  getCapabilities(): AgentCapability[] {
    const configured = this.config.capabilities;
    if (Array.isArray(configured) && configured.length) {
      const mapped = configured.map((c) => CAPABILITY_MAP[String(c).toLowerCase()]).filter((c): c is AgentCapability => !!c);
      if (mapped.length) return mapped;
    }
    return [
      AgentCapability.IMPLEMENTATION,
      AgentCapability.CODE_REVIEW,
      AgentCapability.REFACTORING,
      AgentCapability.TESTING,
      AgentCapability.DOCUMENTATION,
    ];
  }

  async executeTask(task: string, context: Record<string, unknown>): Promise<AgentResponse> {
    const prompt = this.buildLocalLlmPrompt(task, context);
    const payload = { model: this.model, prompt, stream: false, keep_alive: this.keepAlive };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout * 1000);
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return makeResponse({ success: false, output: "", error: `HTTP error: ${res.status} ${res.statusText}` });
      }
      const data = (await res.json()) as Record<string, unknown>;
      return makeResponse({
        success: true,
        output: String(data.response ?? ""),
        metadata: {
          model: this.model,
          eval_count: data.eval_count,
          eval_duration: data.eval_duration,
          prompt_eval_count: data.prompt_eval_count,
          prompt_eval_duration: data.prompt_eval_duration,
        },
      });
    } catch (e) {
      return makeResponse({ success: false, output: "", error: `Connection error: ${e}` });
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.endpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    // Ollama availability is endpoint-based; use checkAvailability() for the real probe.
    return this.enabled;
  }

  override async checkAvailability(): Promise<boolean> {
    return this.enabled && (await this.healthCheck());
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    } catch (e) {
      this.logger.warning(`Failed to list Ollama models from ${this.endpoint}: ${e}`);
      return [];
    }
  }

  async pullModel(model?: string): Promise<AgentResponse> {
    const modelName = model ?? this.model;
    try {
      const res = await fetch(`${this.endpoint}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: false }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return makeResponse({ success: true, output: `Pulled model '${modelName}'` });
    } catch (e) {
      return makeResponse({ success: false, output: "", error: `Failed to pull model: ${e}` });
    }
  }

  async removeModel(model?: string): Promise<AgentResponse> {
    const modelName = model ?? this.model;
    try {
      const res = await fetch(`${this.endpoint}/api/delete`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return makeResponse({ success: true, output: `Removed model '${modelName}'` });
    } catch (e) {
      return makeResponse({ success: false, output: "", error: `Failed to remove model: ${e}` });
    }
  }
}
