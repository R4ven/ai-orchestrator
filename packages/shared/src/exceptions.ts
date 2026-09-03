/** Custom error hierarchy shared across the orchestrator and agentic-team runtimes. */

function makeSerializable(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (["boolean", "number", "string"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(makeSerializable);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, makeSerializable(v)]),
    );
  }
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

export class OrchestratorError extends Error {
  readonly errorCode: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, errorCode = "ORCHESTRATOR_ERROR", details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.details = details;
  }

  toDict(): Record<string, unknown> {
    return {
      error: this.name,
      message: this.message,
      error_code: this.errorCode,
      details: makeSerializable(this.details),
    };
  }
}

export class ConfigurationError extends OrchestratorError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "CONFIG_ERROR", details);
  }
}

export class AgentNotFoundError extends OrchestratorError {
  constructor(agentName: string, details: Record<string, unknown> = {}) {
    super(`Agent '${agentName}' is not available`, "AGENT_NOT_FOUND", { agent_name: agentName, ...details });
  }
}

export class AgentExecutionError extends OrchestratorError {
  constructor(agentName: string, message: string, details: Record<string, unknown> = {}) {
    super(`Agent '${agentName}' execution failed: ${message}`, "AGENT_EXECUTION_ERROR", {
      agent_name: agentName,
      ...details,
    });
  }
}

export class AgentTimeoutError extends OrchestratorError {
  constructor(agentName: string, timeout: number, details: Record<string, unknown> = {}) {
    super(`Agent '${agentName}' timed out after ${timeout} seconds`, "AGENT_TIMEOUT", {
      agent_name: agentName,
      timeout,
      ...details,
    });
  }
}

export class WorkflowError extends OrchestratorError {
  constructor(workflowName: string, message: string, details: Record<string, unknown> = {}) {
    super(`Workflow '${workflowName}' failed: ${message}`, "WORKFLOW_ERROR", {
      workflow_name: workflowName,
      ...details,
    });
  }
}

export class ValidationError extends OrchestratorError {
  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR", field ? { field } : {});
  }
}

export class RateLimitError extends OrchestratorError {
  constructor(limit: number, window: number, details: Record<string, unknown> = {}) {
    super(`Rate limit exceeded: ${limit} requests per ${window} seconds`, "RATE_LIMIT_EXCEEDED", {
      limit,
      window,
      ...details,
    });
  }
}

export class ResourceError extends OrchestratorError {
  constructor(resourceType: string, message: string, details: Record<string, unknown> = {}) {
    super(`Resource error (${resourceType}): ${message}`, "RESOURCE_ERROR", {
      resource_type: resourceType,
      ...details,
    });
  }
}
