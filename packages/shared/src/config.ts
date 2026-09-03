/** YAML configuration loading helpers shared by both runtimes. */
import { readFileSync, existsSync } from "node:fs";
import { load } from "js-yaml";

export function loadYamlConfig<T = Record<string, unknown>>(configPath: string): T | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, "utf-8");
  return (load(raw) as T) ?? ({} as T);
}
