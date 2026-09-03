/** DevOps tools: Dockerfile/compose/CI generation, deployment config checks. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
import { safeHandler } from "../toolResult.js";

const DOCKERFILE_TEMPLATES: Record<string, (opts: { port: number }) => string> = {
  node: ({ port }) => `FROM node:22-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE ${port}
CMD ["node", "dist/index.js"]
`,
  python: ({ port }) => `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${port}
CMD ["python", "-m", "app"]
`,
  go: ({ port }) => `FROM golang:1.23 AS build
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/bin/server .

FROM gcr.io/distroless/static
COPY --from=build /app/bin/server /server
EXPOSE ${port}
ENTRYPOINT ["/server"]
`,
};

export function registerDevopsTools(server: McpServer): void {
  server.tool(
    "generate_dockerfile",
    "Generate a Dockerfile template for a given language.",
    { language: z.enum(["node", "python", "go"]).default("node"), port: z.number().int().positive().default(3000) },
    safeHandler(({ language, port }) => {
      const dockerfile = (DOCKERFILE_TEMPLATES[language] ?? DOCKERFILE_TEMPLATES.node)({ port });
      return { language, port, dockerfile };
    }),
  );

  server.tool(
    "generate_docker_compose",
    "Generate a docker-compose.yml for one or more named services sharing a network.",
    {
      services: z
        .array(z.object({ name: z.string(), image: z.string().optional(), build: z.string().optional(), port: z.number().int().positive().optional() }))
        .min(1),
    },
    safeHandler(({ services }) => {
      const lines = ["services:"];
      for (const svc of services) {
        lines.push(`  ${svc.name}:`);
        if (svc.build) lines.push(`    build: ${svc.build}`);
        else lines.push(`    image: ${svc.image ?? `${svc.name}:latest`}`);
        if (svc.port) lines.push(`    ports:\n      - "${svc.port}:${svc.port}"`);
        lines.push(`    restart: unless-stopped`);
      }
      return { compose_yaml: lines.join("\n") + "\n" };
    }),
  );

  server.tool(
    "generate_ci_config",
    "Generate a CI pipeline config template.",
    { provider: z.enum(["github-actions", "gitlab-ci", "circleci"]).default("github-actions"), node_version: z.string().default("22") },
    safeHandler(({ provider, node_version }) => {
      if (provider === "github-actions") {
        return {
          provider,
          path: ".github/workflows/ci.yml",
          config: `name: CI\non:\n  push:\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "${node_version}"\n      - run: npm ci\n      - run: npm run build\n      - run: npm test\n`,
        };
      }
      if (provider === "gitlab-ci") {
        return {
          provider,
          path: ".gitlab-ci.yml",
          config: `image: node:${node_version}\nstages: [build, test]\nbuild:\n  stage: build\n  script:\n    - npm ci\n    - npm run build\ntest:\n  stage: test\n  script:\n    - npm test\n`,
        };
      }
      return {
        provider,
        path: ".circleci/config.yml",
        config: `version: 2.1\njobs:\n  build:\n    docker:\n      - image: cimg/node:${node_version}\n    steps:\n      - checkout\n      - run: npm ci\n      - run: npm run build\n      - run: npm test\nworkflows:\n  build:\n    jobs:\n      - build\n`,
      };
    }),
  );

  server.tool(
    "analyze_deployment_config",
    "Inspect a Kubernetes/Docker Compose YAML file for common operational gaps.",
    { config_path: z.string().min(1) },
    safeHandler(({ config_path }) => {
      if (!existsSync(config_path)) throw new Error(`Config not found: ${config_path}`);
      const content = readFileSync(config_path, "utf-8");
      const doc = loadYaml(content) as Record<string, unknown> | undefined;

      const findings: string[] = [];
      const text = content;
      if (doc && "kind" in doc) {
        if (!/resources:\s*\n\s*(requests|limits):/.test(text)) findings.push("No resource requests/limits configured.");
        if (!/livenessProbe:/.test(text)) findings.push("No livenessProbe configured.");
        if (!/readinessProbe:/.test(text)) findings.push("No readinessProbe configured.");
        if (/image:\s*\S+:latest/.test(text)) findings.push("Image tag ':latest' used — pin a specific version for reproducible deploys.");
      } else {
        if (!/restart:/.test(text)) findings.push("No restart policy configured for compose services.");
        if (/image:\s*\S+:latest/.test(text)) findings.push("Image tag ':latest' used — pin a specific version.");
      }

      return { config_path, kind: (doc as { kind?: string } | undefined)?.kind ?? "compose", findings, healthy: findings.length === 0 };
    }),
  );

  server.tool(
    "check_environment_config",
    "Parse a .env(.example) file and report configured keys (values redacted).",
    { env_file: z.string().default(".env.example") },
    safeHandler(({ env_file }) => {
      if (!existsSync(env_file)) throw new Error(`Env file not found: ${env_file}`);
      const lines = readFileSync(env_file, "utf-8").split("\n");
      const keys: string[] = [];
      const emptyValues: string[] = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        keys.push(key);
        if (!value) emptyValues.push(key);
      }

      return { env_file, key_count: keys.length, keys, keys_without_default_value: emptyValues };
    }),
  );

  server.tool(
    "generate_deploy_checklist",
    "Generate a pre-deployment checklist for a given deployment target.",
    { target: z.enum(["docker", "kubernetes", "systemd"]).default("docker") },
    safeHandler(({ target }) => {
      const common = [
        "Run the full test suite and confirm it is green.",
        "Confirm environment variables/secrets are set for the target environment.",
        "Confirm logging and monitoring are wired up.",
        "Have a rollback plan.",
      ];
      const specific: Record<string, string[]> = {
        docker: ["Pin base image and dependency versions.", "Confirm the image builds reproducibly (`docker build --no-cache`).", "Set resource limits via `docker run --memory/--cpus` or compose."],
        kubernetes: ["Set resource requests/limits.", "Configure liveness/readiness probes.", "Confirm rolling-update strategy and replica count.", "Review NetworkPolicy and RBAC scope."],
        systemd: ["Set `Restart=on-failure` in the unit file.", "Confirm the service runs as a non-root user.", "Set up log rotation for stdout/stderr."],
      };
      return { target, checklist: [...common, ...(specific[target] ?? [])] };
    }),
  );
}
