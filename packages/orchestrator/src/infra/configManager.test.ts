import { describe, it, expect } from "vitest";
import { getDefaultConfig, validateConfig, type OrchestratorConfig } from "./configManager.js";

describe("getDefaultConfig", () => {
  it("defines agents referenced by every default workflow", () => {
    const config = getDefaultConfig();
    for (const [name, workflow] of Object.entries(config.workflows)) {
      const steps = Array.isArray(workflow) ? workflow : workflow.steps;
      for (const step of steps ?? []) {
        expect(config.agents, `workflow '${name}' step agent '${step.agent}'`).toHaveProperty(step.agent as string);
      }
    }
  });

  it("passes its own validation with no problems", () => {
    expect(validateConfig(getDefaultConfig())).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("flags an empty agents map", () => {
    const config: OrchestratorConfig = { agents: {}, workflows: { default: [{ agent: "codex", task: "implement" }] }, settings: {} };
    const problems = validateConfig(config);
    expect(problems).toContain("No agents defined in configuration.");
  });

  it("flags a workflow with no steps", () => {
    const config: OrchestratorConfig = {
      agents: { codex: { enabled: true } },
      workflows: { empty: [] },
      settings: {},
    };
    const problems = validateConfig(config);
    expect(problems).toContain("Workflow 'empty' has no steps.");
  });

  it("flags a workflow step referencing an unknown agent", () => {
    const config: OrchestratorConfig = {
      agents: { codex: { enabled: true } },
      workflows: { default: [{ agent: "does-not-exist", task: "implement" }] },
      settings: {},
    };
    const problems = validateConfig(config);
    expect(problems).toContain("Workflow 'default' references unknown agent 'does-not-exist'.");
  });

  it("flags a fallback map entry referencing an unknown agent", () => {
    const config: OrchestratorConfig = {
      agents: { codex: { enabled: true } },
      workflows: { default: [{ agent: "codex", task: "implement" }] },
      settings: { fallback: { enabled: true, map: { codex: "ghost-agent" } } },
    };
    const problems = validateConfig(config);
    expect(problems).toContain("Fallback map references unknown target agent 'ghost-agent'.");
  });
});
