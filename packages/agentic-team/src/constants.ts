/** Constants used by the standalone Agentic Team runtime. */

export const DEFAULT_TEAM_MAX_TURNS = 12;
export const DEFAULT_MAX_MESSAGE_CHARS = 5000;
export const DEFAULT_REPEAT_ROUTE_LIMIT = 3;
export const MAX_TASK_LENGTH = 50_000;

export const ROLE_PROJECT_MANAGER = "project_manager";
export const ROLE_SOFTWARE_ARCHITECT = "software_architect";
export const ROLE_SOFTWARE_DEVELOPER = "software_developer";
export const ROLE_QA_ENGINEER = "qa_engineer";
export const ROLE_DEVOPS_ENGINEER = "devops_engineer";

export const DEFAULT_TEAM_ROLE_ORDER = [
  ROLE_PROJECT_MANAGER,
  ROLE_SOFTWARE_ARCHITECT,
  ROLE_SOFTWARE_DEVELOPER,
  ROLE_QA_ENGINEER,
  ROLE_DEVOPS_ENGINEER,
] as const;
