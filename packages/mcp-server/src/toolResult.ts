/** Helpers for building MCP tool call results. */

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(value: unknown): ToolTextResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function errorResult(error: unknown): ToolTextResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Wrap a tool handler so thrown errors become a structured MCP error result instead of crashing the server. */
export function safeHandler<Args extends Record<string, unknown>>(
  fn: (args: Args) => Promise<unknown> | unknown,
): (args: Args) => Promise<ToolTextResult> {
  return async (args: Args) => {
    try {
      const result = await fn(args);
      return textResult(result);
    } catch (e) {
      return errorResult(e);
    }
  };
}
