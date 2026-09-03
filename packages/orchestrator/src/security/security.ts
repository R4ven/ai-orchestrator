/** Security utilities: input validation, rate limiting, secrets, and audit logging. */
import { resolve, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { ValidationError, RateLimitError, getLogger } from "@ai-orchestrator/shared";

const MAX_TASK_LENGTH = 10_000;
const MAX_WORKFLOW_NAME_LENGTH = 100;
const MAX_AGENT_NAME_LENGTH = 50;
const MAX_FILE_PATH_LENGTH = 4096;

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf/i,
  /del\s+\/[FS]/i,
  /format\s+[A-Z]:/i,
  />\s*\/dev\//i,
  /curl.*\|\s*bash/i,
  /wget.*\|\s*sh/i,
];

export class InputValidator {
  static validateTask(task: string): string {
    if (!task?.trim()) throw new ValidationError("Task description cannot be empty", "task");
    if (task.length > MAX_TASK_LENGTH) {
      throw new ValidationError(`Task description exceeds maximum length of ${MAX_TASK_LENGTH}`, "task");
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(task)) {
        throw new ValidationError(`Task contains potentially dangerous pattern: ${pattern}`, "task");
      }
    }
    return task.trim();
  }

  static validateWorkflowName(name: string): string {
    if (!name?.trim()) throw new ValidationError("Workflow name cannot be empty", "workflow");
    if (name.length > MAX_WORKFLOW_NAME_LENGTH) {
      throw new ValidationError(`Workflow name exceeds maximum length of ${MAX_WORKFLOW_NAME_LENGTH}`, "workflow");
    }
    if (!NAME_PATTERN.test(name)) {
      throw new ValidationError("Workflow name can only contain letters, numbers, underscores, and hyphens", "workflow");
    }
    return name;
  }

  static validateAgentName(name: string): string {
    if (!name?.trim()) throw new ValidationError("Agent name cannot be empty", "agent");
    if (name.length > MAX_AGENT_NAME_LENGTH) {
      throw new ValidationError(`Agent name exceeds maximum length of ${MAX_AGENT_NAME_LENGTH}`, "agent");
    }
    if (!NAME_PATTERN.test(name)) {
      throw new ValidationError("Agent name can only contain letters, numbers, underscores, and hyphens", "agent");
    }
    return name;
  }

  static validateFilePath(path: string, options: { mustExist?: boolean; allowedRoot?: string } = {}): string {
    if (!path?.trim()) throw new ValidationError("File path cannot be empty", "path");
    if (path.length > MAX_FILE_PATH_LENGTH) {
      throw new ValidationError(`File path exceeds maximum length of ${MAX_FILE_PATH_LENGTH}`, "path");
    }

    const resolvedPath = resolve(path);

    if (options.allowedRoot) {
      const allowedRoot = resolve(options.allowedRoot);
      const rel = relative(allowedRoot, resolvedPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new ValidationError("Path traversal detected: path is outside allowed directory", "path");
      }
    }

    if (options.mustExist && !existsSync(resolvedPath)) {
      throw new ValidationError(`File does not exist: ${path}`, "path");
    }

    return resolvedPath;
  }

  static validateCommand(command: string, allowedCommands?: string[]): string {
    if (!command?.trim()) throw new ValidationError("Command cannot be empty", "command");
    if (allowedCommands && !allowedCommands.includes(command)) {
      throw new ValidationError(`Command '${command}' is not in allowed list: ${allowedCommands}`, "command");
    }
    return command;
  }
}

interface Bucket {
  tokens: number;
  lastUpdate: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;

  constructor(
    private readonly rate = 60,
    private readonly window = 60,
    capacity?: number,
  ) {
    this.capacity = capacity ?? rate;
  }

  private getBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastUpdate: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastUpdate) / 1000;
    const tokensToAdd = (elapsedSeconds / this.window) * this.rate;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastUpdate = now;
  }

  checkLimit(key: string, tokens = 1): boolean {
    const bucket = this.getBucket(key);
    this.refill(bucket);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }
    throw new RateLimitError(this.rate, this.window, { key, tokens_available: bucket.tokens });
  }

  getWaitTime(key: string, tokens = 1): number {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    if (bucket.tokens >= tokens) return 0;
    const tokensNeeded = tokens - bucket.tokens;
    return (tokensNeeded / this.rate) * this.window;
  }
}

const SECRET_PREFIXES = ["API_KEY_", "SECRET_", "TOKEN_", "PASSWORD_"];

export class SecretManager {
  private readonly secrets = new Map<string, string>();

  constructor() {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        this.secrets.set(key, value);
      }
    }
  }

  get(key: string): string | undefined {
    return this.secrets.get(key);
  }

  has(key: string): boolean {
    return this.secrets.has(key);
  }

  /** Never log a secret's actual value; expose only whether it is configured. */
  redactedKeys(): string[] {
    return [...this.secrets.keys()];
  }
}

export interface AuditEvent {
  timestamp: string;
  action: string;
  actor?: string;
  details: Record<string, unknown>;
}

export class AuditLogger {
  private readonly logger = getLogger("orchestrator.audit");
  private readonly events: AuditEvent[] = [];

  record(action: string, details: Record<string, unknown> = {}, actor?: string): void {
    const event: AuditEvent = { timestamp: new Date().toISOString(), action, actor, details };
    this.events.push(event);
    this.logger.info(`AUDIT ${action}`, { actor, ...details });
  }

  getEvents(): AuditEvent[] {
    return [...this.events];
  }
}
