import { describe, it, expect } from "vitest";
import { DecisionParser } from "./decisionParser.js";

describe("DecisionParser.extractJsonObject", () => {
  const parser = new DecisionParser();

  it("parses a raw JSON object", () => {
    const result = parser.extractJsonObject('{"action": "message", "to_role": "qa_engineer"}');
    expect(result).toEqual({ action: "message", to_role: "qa_engineer" });
  });

  it("parses JSON inside a fenced code block", () => {
    const text = 'Here is my decision:\n```json\n{"action": "finalize", "final_response": "done"}\n```\nThanks.';
    const result = parser.extractJsonObject(text);
    expect(result).toEqual({ action: "finalize", final_response: "done" });
  });

  it("parses JSON embedded in surrounding prose via streaming scan", () => {
    const text = 'Sure thing! {"action": "message", "to_role": "project_manager", "message": "ok"} — hope that helps.';
    const result = parser.extractJsonObject(text);
    expect(result).toMatchObject({ action: "message", to_role: "project_manager" });
  });

  it("returns null for text with no JSON object", () => {
    expect(parser.extractJsonObject("no json here at all")).toBeNull();
  });
});

describe("DecisionParser.parseDecision", () => {
  const parser = new DecisionParser();

  it("defaults to action=message and the default recipient when output has no structure", () => {
    const decision = parser.parseDecision({
      output: "just some free text",
      currentRole: "software_developer",
      leadRole: "project_manager",
      defaultToRole: "project_manager",
    });
    expect(decision.action).toBe("message");
    expect(decision.to_role).toBe("project_manager");
    expect(decision.message).toBe("just some free text");
  });

  it("normalizes to_role/target_role/next_role and role casing", () => {
    const decision = parser.parseDecision({
      output: '{"action": "message", "to_role": "QA Engineer", "message": "please review"}',
      currentRole: "software_developer",
      leadRole: "project_manager",
      defaultToRole: "project_manager",
    });
    expect(decision.to_role).toBe("qa_engineer");
    expect(decision.message).toBe("please review");
  });

  it("redirects a non-lead role's finalize attempt back to the lead", () => {
    const decision = parser.parseDecision({
      output: '{"action": "finalize", "final_response": "all done"}',
      currentRole: "qa_engineer",
      leadRole: "project_manager",
      defaultToRole: "project_manager",
    });
    expect(decision.action).toBe("message");
    expect(decision.to_role).toBe("project_manager");
  });

  it("allows the lead role to finalize", () => {
    const decision = parser.parseDecision({
      output: '{"action": "finalize", "final_response": "shipped"}',
      currentRole: "project_manager",
      leadRole: "project_manager",
      defaultToRole: "project_manager",
    });
    expect(decision.action).toBe("finalize");
    expect(decision.final_response).toBe("shipped");
  });

  it("falls back to key-value line parsing when JSON extraction fails", () => {
    const decision = parser.parseDecision({
      output: "action: message\nto_role: software_developer\nSome other free-form notes.",
      currentRole: "project_manager",
      leadRole: "project_manager",
      defaultToRole: "project_manager",
    });
    expect(decision.action).toBe("message");
    expect(decision.to_role).toBe("software_developer");
  });
});
