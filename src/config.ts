import "dotenv/config";
import * as path from "path";
import type { ServerConfig } from "./types.js";

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be an integer, got: "${raw}"`
    );
  }
  return parsed;
}

function getEnvList(key: string, fallback: string[] = []): string[] {
  const raw = process.env[key];
  if (!raw || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getLogLevel(
  raw: string
): "debug" | "info" | "warn" | "error" {
  const valid = ["debug", "info", "warn", "error"] as const;
  if (valid.includes(raw as (typeof valid)[number])) {
    return raw as (typeof valid)[number];
  }
  return "info";
}

export function loadConfig(): ServerConfig {
  const fileReaderRoot = path.resolve(
    getEnv("FILE_READER_ROOT", "./workspace")
  );

  // M4: Reject filesystem root to prevent accidental full-disk exposure
  const fsRoot = path.parse(fileReaderRoot).root;
  if (fileReaderRoot === fsRoot || fileReaderRoot === fsRoot.replace(/\/+$/, "")) {
    throw new Error(
      `FILE_READER_ROOT must not be the filesystem root ("${fsRoot}"). ` +
      `Set it to a specific directory.`
    );
  }

  return {
    name: getEnv("SERVER_NAME", "mcp-starter-kit"),
    version: getEnv("SERVER_VERSION", "1.0.0"),
    fetchMaxBytes: getEnvInt("FETCH_MAX_BYTES", 1_048_576),
    fetchTimeoutMs: getEnvInt("FETCH_TIMEOUT_MS", 10_000),
    fetchBlockedDomains: getEnvList("FETCH_BLOCKED_DOMAINS"),
    fileReaderRoot,
    transformerMaxInput: getEnvInt("TRANSFORMER_MAX_INPUT", 50_000),
    logLevel: getLogLevel(getEnv("LOG_LEVEL", "info")),
  };
}

export const config = loadConfig();
