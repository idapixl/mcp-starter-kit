import { config } from "./config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${level.toUpperCase().padEnd(5)} ${message}`;
  if (meta !== undefined) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

// MCP uses stdio for communication, so all logging MUST go to stderr
export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog("debug")) {
      process.stderr.write(format("debug", message, meta) + "\n");
    }
  },
  info(message: string, meta?: unknown): void {
    if (shouldLog("info")) {
      process.stderr.write(format("info", message, meta) + "\n");
    }
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog("warn")) {
      process.stderr.write(format("warn", message, meta) + "\n");
    }
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog("error")) {
      process.stderr.write(format("error", message, meta) + "\n");
    }
  },
};
