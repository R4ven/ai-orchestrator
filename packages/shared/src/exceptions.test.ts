import { describe, it, expect } from "vitest";
import {
  OrchestratorError,
  ConfigurationError,
  AgentNotFoundError,
  AgentExecutionError,
  AgentTimeoutError,
  WorkflowError,
  ValidationError,
  RateLimitError,
} from "./exceptions.js";

describe("OrchestratorError hierarchy", () => {
  it("carries a default error code and empty details", () => {
    const err = new OrchestratorError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.errorCode).toBe("ORCHESTRATOR_ERROR");
    expect(err.toDict()).toEqual({
      error: "OrchestratorError",
      message: "something broke",
      error_code: "ORCHESTRATOR_ERROR",
      details: {},
    });
  });

  it("ConfigurationError sets the CONFIG_ERROR code", () => {
    const err = new ConfigurationError("bad config", { file: "agents.yaml" });
    expect(err.errorCode).toBe("CONFIG_ERROR");
    expect(err.toDict().details).toEqual({ file: "agents.yaml" });
  });

  it("AgentNotFoundError includes the agent name in message and details", () => {
    const err = new AgentNotFoundError("codex");
    expect(err.message).toBe("Agent 'codex' is not available");
    expect(err.errorCode).toBe("AGENT_NOT_FOUND");
    expect(err.details.agent_name).toBe("codex");
  });

  it("AgentExecutionError composes the agent name into the message", () => {
    const err = new AgentExecutionError("gemini", "boom");
    expect(err.message).toBe("Agent 'gemini' execution failed: boom");
    expect(err.errorCode).toBe("AGENT_EXECUTION_ERROR");
  });

  it("AgentTimeoutError includes the timeout value", () => {
    const err = new AgentTimeoutError("claude", 30);
    expect(err.message).toBe("Agent 'claude' timed out after 30 seconds");
    expect(err.details.timeout).toBe(30);
  });

  it("WorkflowError composes the workflow name into the message", () => {
    const err = new WorkflowError("default", "no steps");
    expect(err.message).toBe("Workflow 'default' failed: no steps");
  });

  it("ValidationError optionally attaches a field", () => {
    const withField = new ValidationError("required", "task");
    expect(withField.details).toEqual({ field: "task" });

    const withoutField = new ValidationError("required");
    expect(withoutField.details).toEqual({});
  });

  it("RateLimitError includes limit and window", () => {
    const err = new RateLimitError(60, 60);
    expect(err.message).toBe("Rate limit exceeded: 60 requests per 60 seconds");
    expect(err.details).toMatchObject({ limit: 60, window: 60 });
  });

  it("serializes nested Error values in details to strings", () => {
    const err = new OrchestratorError("wrapped", "WRAPPED", { cause: new Error("inner") });
    expect(err.toDict().details).toEqual({ cause: "Error: inner" });
  });

  it("is an instanceof Error and of its own subclass", () => {
    const err = new ConfigurationError("x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OrchestratorError);
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.name).toBe("ConfigurationError");
  });
});
