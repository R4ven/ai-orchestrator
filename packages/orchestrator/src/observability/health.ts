/** Health and readiness probes. */
import type { BaseAdapter } from "@ai-orchestrator/shared";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  agents: Record<string, { available: boolean }>;
  offlineMode: boolean;
}

export async function checkHealth(
  adapters: Record<string, BaseAdapter>,
  offlineMode: boolean,
): Promise<HealthStatus> {
  const agentStatus: Record<string, { available: boolean }> = {};
  await Promise.all(
    Object.entries(adapters).map(async ([name, adapter]) => {
      agentStatus[name] = { available: await adapter.checkAvailability() };
    }),
  );

  const availableCount = Object.values(agentStatus).filter((a) => a.available).length;
  const total = Object.keys(agentStatus).length;

  let status: HealthStatus["status"] = "healthy";
  if (total === 0 || availableCount === 0) status = "unhealthy";
  else if (availableCount < total) status = "degraded";

  return { status, timestamp: new Date().toISOString(), agents: agentStatus, offlineMode };
}

export function isReady(adapters: Record<string, BaseAdapter>): boolean {
  return Object.keys(adapters).length > 0;
}
