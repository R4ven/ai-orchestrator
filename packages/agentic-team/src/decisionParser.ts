/** Robust decision parsing for agentic team handoff messages. */
import { getLogger } from "@ai-orchestrator/shared";
import { normalizeRole } from "./configUtils.js";

const logger = getLogger("agentic_team.decision_parser");

const FENCED_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/gi;
const LINE_TO_ROLE_RE = /^\s*(?:to_role|target_role|next_role)\s*:\s*(.+?)\s*$/i;
const LINE_ACTION_RE = /^\s*action\s*:\s*(.+?)\s*$/i;
const LINE_FINAL_RE = /^\s*(?:final_response|user_response)\s*:\s*(.+?)\s*$/i;

export interface Decision {
  action: "message" | "finalize";
  to_role: string | null;
  message: string;
  final_response: string;
}

export class DecisionParser {
  extractJsonObject(text: string): Record<string, unknown> | null {
    return this.extractFirstJsonObject(text);
  }

  private extractFirstJsonObject(text: string): Record<string, unknown> | null {
    const candidate = (text ?? "").trim();
    if (!candidate) return null;

    const direct = tryParseObject(candidate);
    if (direct) return direct;

    for (const match of candidate.matchAll(FENCED_BLOCK_RE)) {
      const block = (match[1] ?? "").trim();
      if (!block) continue;
      const parsed = tryParseObject(block);
      if (parsed) return parsed;
    }

    // Streaming-style scan: try parsing starting at every '{' until one succeeds.
    for (let idx = 0; idx < candidate.length; idx++) {
      if (candidate[idx] !== "{") continue;
      const parsed = tryRawDecode(candidate.slice(idx));
      if (parsed) return parsed;
    }

    return null;
  }

  private extractFromKvLines(text: string): Record<string, string> {
    const data: Record<string, string> = {};
    for (const rawLine of String(text ?? "").split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      const actionMatch = LINE_ACTION_RE.exec(line);
      if (actionMatch && !("action" in data)) {
        data.action = (actionMatch[1] ?? "").trim();
        continue;
      }
      const toRoleMatch = LINE_TO_ROLE_RE.exec(line);
      if (toRoleMatch && !("to_role" in data)) {
        data.to_role = (toRoleMatch[1] ?? "").trim();
        continue;
      }
      const finalMatch = LINE_FINAL_RE.exec(line);
      if (finalMatch && !("final_response" in data)) {
        data.final_response = (finalMatch[1] ?? "").trim();
      }
    }
    return data;
  }

  parseDecision(params: { output: string; currentRole: string; leadRole: string; defaultToRole: string }): Decision {
    const { output, currentRole, leadRole, defaultToRole } = params;
    const payload = this.extractFirstJsonObject(output) ?? this.extractFromKvLines(output);

    let action = String(payload.action ?? "message").trim().toLowerCase();
    if (action !== "message" && action !== "finalize") action = "message";

    const toRoleRaw = payload.to_role ?? payload.target_role ?? payload.next_role;
    let toRoleNorm: string | null = null;
    if (typeof toRoleRaw === "string" && toRoleRaw.trim()) toRoleNorm = normalizeRole(toRoleRaw);

    let message = payload.message ?? payload.instruction ?? payload.deliverable;
    if (typeof message !== "string" || !message.trim()) message = (output ?? "").trim();

    let finalResponse = payload.final_response ?? payload.user_response;
    if (typeof finalResponse !== "string") finalResponse = "";

    if (action === "finalize" && currentRole !== leadRole) {
      logger.info(`Non-lead role '${currentRole}' attempted finalize, redirecting to lead '${leadRole}'`);
      action = "message";
      toRoleNorm = leadRole;
    }

    if (action === "message" && !toRoleNorm) toRoleNorm = defaultToRole;

    return {
      action: action as "message" | "finalize",
      to_role: toRoleNorm,
      message: message as string,
      final_response: finalResponse as string,
    };
  }
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Best-effort equivalent of Python's json.JSONDecoder.raw_decode: parse a JSON value
 * starting at index 0, ignoring trailing content, without throwing on the trailer. */
function tryRawDecode(text: string): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return tryParseObject(text.slice(0, i + 1));
      }
    }
  }
  return null;
}
