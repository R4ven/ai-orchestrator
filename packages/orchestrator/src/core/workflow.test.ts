import { describe, it, expect } from "vitest";
import { WorkflowStep } from "./workflow.js";
import type { BaseAdapter } from "@ai-orchestrator/shared";

function stubAdapter(): BaseAdapter {
  return { executeTask: async () => ({ success: true, output: "", filesModified: [], suggestions: [], metadata: {} }) } as unknown as BaseAdapter;
}

describe("WorkflowStep.buildTaskDescription", () => {
  const context = { task: "add a login page" };

  it.each([
    ["implement", "Implement the following: add a login page"],
    ["review", "Review the implementation of: add a login page"],
    ["refine", "Refine the implementation based on review feedback for: add a login page"],
    ["test", "Write tests for: add a login page"],
    ["document", "Document the implementation of: add a login page"],
  ])("formats the %s task type", (taskType, expected) => {
    const step = new WorkflowStep("codex", taskType, stubAdapter(), {});
    expect(step.buildTaskDescription(context)).toBe(expected);
  });

  it("falls back to the raw task for unknown task types", () => {
    const step = new WorkflowStep("codex", "suggestions", stubAdapter(), {});
    expect(step.buildTaskDescription(context)).toBe("add a login page");
  });
});

describe("WorkflowStep.buildStepContext", () => {
  it("adds role and agent to a copy of the context, without mutating the original", () => {
    const step = new WorkflowStep("gemini", "review", stubAdapter(), {});
    const context = { task: "x", previous_output: "y" };
    const stepContext = step.buildStepContext(context);

    expect(stepContext).toEqual({ task: "x", previous_output: "y", role: "review", agent: "gemini" });
    expect(context).toEqual({ task: "x", previous_output: "y" });
  });
});
