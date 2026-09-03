/** Config normalization and validation helpers for the Agentic Team. */
import {
  DEFAULT_TEAM_MAX_TURNS,
  ROLE_DEVOPS_ENGINEER,
  ROLE_PROJECT_MANAGER,
  ROLE_QA_ENGINEER,
  ROLE_SOFTWARE_ARCHITECT,
  ROLE_SOFTWARE_DEVELOPER,
} from "./constants.js";

export interface RoleSpec {
  title?: string;
  agent?: string | null;
  responsibilities?: string;
  fallback?: string;
  [key: string]: unknown;
}

export interface TeamConfig {
  lead_role: string;
  max_turns: number;
  roles: Record<string, RoleSpec>;
}

export interface RawAgenticTeamConfig {
  lead_role?: string;
  max_turns?: number;
  roles?: Record<string, RoleSpec | string>;
}

/** Normalize a role name into canonical snake_case form. */
export function normalizeRole(role: string): string {
  const raw = String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  return raw.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function coercePositiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

export function defaultRoles(pickPreferredAgent: (preferred: string[]) => string | undefined): Record<string, RoleSpec> {
  // Cloud CLIs are preferred when available; local Ollama/llama.cpp agents are
  // listed last in each role's preference order so a pure-local, no-cloud-CLI
  // setup (e.g. the desktop app on a fresh machine) still gets sensible
  // per-role agent picks instead of just falling back to "whatever's first".
  return {
    [ROLE_PROJECT_MANAGER]: {
      title: "Project Manager (Team Lead)",
      agent: pickPreferredAgent(["claude", "gemini", "codex", "copilot", "local-instruct", "local-code", "local-large"]),
      responsibilities: "Initiate work, route subtasks, and perform final approval.",
    },
    [ROLE_SOFTWARE_ARCHITECT]: {
      title: "Software Architect",
      agent: pickPreferredAgent(["gemini", "claude", "codex", "copilot", "local-instruct", "local-large", "local-code"]),
      responsibilities: "Define architecture and technical design.",
    },
    [ROLE_SOFTWARE_DEVELOPER]: {
      title: "Software Developer",
      agent: pickPreferredAgent(["codex", "claude", "copilot", "gemini", "local-code", "local-large", "local-instruct"]),
      responsibilities: "Implement and update source code.",
    },
    [ROLE_QA_ENGINEER]: {
      title: "QA Engineer",
      agent: pickPreferredAgent(["gemini", "copilot", "claude", "codex", "local-instruct", "local-code", "local-large"]),
      responsibilities: "Validate behavior and identify regressions.",
    },
    [ROLE_DEVOPS_ENGINEER]: {
      title: "DevOps Engineer",
      agent: pickPreferredAgent(["claude", "codex", "gemini", "copilot", "local-instruct", "local-code", "local-large"]),
      responsibilities: "Handle deployment, runtime, and operational concerns.",
    },
  };
}

export function resolveTeamConfig(
  rawAgenticTeam: RawAgenticTeamConfig | undefined,
  pickPreferredAgent: (preferred: string[]) => string | undefined,
): TeamConfig {
  const roles = defaultRoles(pickPreferredAgent);

  if (rawAgenticTeam?.roles && typeof rawAgenticTeam.roles === "object") {
    for (const [rawRole, rawSpec] of Object.entries(rawAgenticTeam.roles)) {
      const roleName = normalizeRole(rawRole);
      if (!roleName) continue;

      const spec: RoleSpec = typeof rawSpec === "string" ? { agent: rawSpec } : { ...rawSpec };
      const merged: RoleSpec = { ...roles[roleName], ...spec };
      if (!merged.title) merged.title = titleCase(roleName.replace(/_/g, " "));
      if (!merged.agent) {
        const fallbackAgent = pickPreferredAgent([]);
        if (fallbackAgent) merged.agent = fallbackAgent;
      }
      roles[roleName] = merged;
    }
  }

  const leadRole = normalizeRole(rawAgenticTeam?.lead_role ?? ROLE_PROJECT_MANAGER);
  const maxTurns = coercePositiveInt(rawAgenticTeam?.max_turns ?? DEFAULT_TEAM_MAX_TURNS, DEFAULT_TEAM_MAX_TURNS);

  return { lead_role: leadRole, max_turns: maxTurns, roles };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface TeamValidationResult {
  valid: boolean;
  available_agents: string[];
  missing_roles: Array<{ role: string; agent?: string | null }>;
  reason: string;
  error?: string;
}

export function validateTeamBindings(teamCfg: TeamConfig, availableAgents: string[]): TeamValidationResult {
  const roles = teamCfg?.roles ?? {};
  const leadRole = teamCfg?.lead_role ?? "";
  const available = [...availableAgents].map(String).sort();
  const availableSet = new Set(available);

  if (!Object.keys(roles).length) {
    return {
      valid: false,
      available_agents: available,
      missing_roles: [],
      reason: "no_roles_configured",
      error: "Agentic team has no roles configured",
    };
  }

  if (!(leadRole in roles)) {
    return {
      valid: false,
      available_agents: available,
      missing_roles: [],
      reason: "invalid_lead_role",
      error: `Lead role '${leadRole}' is not configured`,
    };
  }

  const missingRoles: Array<{ role: string; agent?: string | null }> = [];
  for (const [roleName, roleSpec] of Object.entries(roles)) {
    const agentName = roleSpec?.agent;
    if (!agentName || !availableSet.has(agentName)) {
      missingRoles.push({ role: roleName, agent: agentName ?? null });
    }
  }

  let reason = "";
  if (!available.length) reason = "no_available_agents";
  else if (missingRoles.length) reason = "invalid_mappings";

  return {
    valid: missingRoles.length === 0 && available.length > 0,
    available_agents: available,
    missing_roles: missingRoles,
    reason,
  };
}
