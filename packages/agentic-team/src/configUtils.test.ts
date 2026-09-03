import { describe, it, expect } from "vitest";
import { normalizeRole, resolveTeamConfig, validateTeamBindings } from "./configUtils.js";

describe("normalizeRole", () => {
  it("lowercases and converts spaces/hyphens to underscores", () => {
    expect(normalizeRole("Software Architect")).toBe("software_architect");
    expect(normalizeRole("qa-engineer")).toBe("qa_engineer");
  });

  it("collapses consecutive separators and trims leading/trailing underscores", () => {
    expect(normalizeRole("  DevOps   Engineer  ")).toBe("devops_engineer");
    expect(normalizeRole("--lead--")).toBe("lead");
  });
});

describe("resolveTeamConfig", () => {
  it("builds the five default roles when nothing is configured", () => {
    const cfg = resolveTeamConfig(undefined, () => "claude");
    expect(Object.keys(cfg.roles).sort()).toEqual(
      ["devops_engineer", "project_manager", "qa_engineer", "software_architect", "software_developer"].sort(),
    );
    expect(cfg.lead_role).toBe("project_manager");
    expect(cfg.max_turns).toBe(12);
  });

  it("merges configured role overrides onto the defaults", () => {
    const cfg = resolveTeamConfig(
      { lead_role: "software-architect", max_turns: 5, roles: { project_manager: { agent: "gemini" } } },
      () => "claude",
    );
    expect(cfg.lead_role).toBe("software_architect");
    expect(cfg.max_turns).toBe(5);
    expect(cfg.roles.project_manager?.agent).toBe("gemini");
    // Untouched roles still get a default title/agent.
    expect(cfg.roles.qa_engineer?.agent).toBe("claude");
  });

  it("accepts a bare agent name string as a role override", () => {
    const cfg = resolveTeamConfig({ roles: { software_developer: "codex" } }, () => "claude");
    expect(cfg.roles.software_developer?.agent).toBe("codex");
  });
});

describe("validateTeamBindings", () => {
  it("is invalid when no roles are configured", () => {
    const result = validateTeamBindings({ lead_role: "project_manager", max_turns: 12, roles: {} }, ["claude"]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("no_roles_configured");
  });

  it("is invalid when the lead role isn't in the roles map", () => {
    const result = validateTeamBindings(
      { lead_role: "missing_role", max_turns: 12, roles: { project_manager: { agent: "claude" } } },
      ["claude"],
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_lead_role");
  });

  it("flags roles whose agent is not currently available", () => {
    const result = validateTeamBindings(
      {
        lead_role: "project_manager",
        max_turns: 12,
        roles: {
          project_manager: { agent: "claude" },
          software_developer: { agent: "codex" },
        },
      },
      ["claude"],
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_mappings");
    expect(result.missing_roles).toEqual([{ role: "software_developer", agent: "codex" }]);
  });

  it("is valid when every role maps to an available agent", () => {
    const result = validateTeamBindings(
      { lead_role: "project_manager", max_turns: 12, roles: { project_manager: { agent: "claude" } } },
      ["claude", "codex"],
    );
    expect(result.valid).toBe(true);
    expect(result.missing_roles).toEqual([]);
  });
});
