/**
 * Minimal structured logger (structlog-equivalent).
 * Supports leveled, namespaced loggers with optional JSON output.
 */
import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warning" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const LEVEL_COLOR: Record<LogLevel, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.cyan,
  warning: chalk.yellow,
  error: chalk.red,
};

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  file?: string;
}

let globalLevel: LogLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";
let globalJson = process.env.LOG_JSON === "1";
let fileStream: NodeJS.WritableStream | null = null;

export function configureLogging(options: LoggerOptions): void {
  if (options.level) globalLevel = options.level;
  if (options.json !== undefined) globalJson = options.json;
  if (options.file) {
    // Lazy import to keep this module fs-free by default (browser-safe callers).
    void import("node:fs").then(({ createWriteStream }) => {
      fileStream = createWriteStream(options.file as string, { flags: "a" });
    });
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[globalLevel];
}

function format(namespace: string, level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  if (globalJson) {
    return JSON.stringify({ timestamp, level, namespace, message, ...(meta ? { meta } : {}) });
  }
  const color = LEVEL_COLOR[level];
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
  return `${chalk.dim(timestamp)} ${color(level.toUpperCase().padEnd(7))} ${chalk.bold(
    `[${namespace}]`,
  )} ${message}${chalk.dim(metaStr)}`;
}

export class Logger {
  constructor(private readonly namespace: string) {}

  child(suffix: string): Logger {
    return new Logger(`${this.namespace}.${suffix}`);
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (!shouldLog(level)) return;
    const line = format(this.namespace, level, message, meta);
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
    if (fileStream) {
      fileStream.write(line.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
    }
  }

  debug(message: string, meta?: unknown): void {
    this.emit("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.emit("info", message, meta);
  }

  warning(message: string, meta?: unknown): void {
    this.emit("warning", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.emit("error", message, meta);
  }
}

const loggerCache = new Map<string, Logger>();

export function getLogger(namespace: string): Logger {
  let logger = loggerCache.get(namespace);
  if (!logger) {
    logger = new Logger(namespace);
    loggerCache.set(namespace, logger);
  }
  return logger;
}
