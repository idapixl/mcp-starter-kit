import { config } from "../config.js";
import { logger } from "../logger.js";
import type {
  FetchUrlInput,
  FetchUrlResult,
  ToolResult,
} from "../types.js";

/**
 * Fetches the content of a URL and returns it as plain text.
 *
 * Security considerations:
 * - Blocks file:, data:, javascript: and any non-http/https scheme
 * - Blocks loopback, link-local, and RFC 1918 private IP addresses (SSRF)
 * - Blocks domains listed in FETCH_BLOCKED_DOMAINS
 * - Strips caller-controlled sensitive headers before forwarding
 * - Enforces a configurable max response size
 * - Strips binary content (returns only text/* and application/json)
 */

/** Headers that must never be forwarded from caller-supplied input (M1). */
const BLOCKED_HEADERS = new Set([
  "host",
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-forwarded-for",
  "x-real-ip",
]);

/**
 * Returns true if the hostname is a raw IPv4 or IPv6 address that falls
 * within loopback, link-local, or RFC 1918 private ranges (H1).
 */
function isPrivateIp(hostname: string): boolean {
  // Strip IPv6 brackets e.g. [::1]
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // IPv4
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    // 127.0.0.0/8 — loopback
    if (a === 127) return true;
    // 10.0.0.0/8 — RFC 1918
    if (a === 10) return true;
    // 172.16.0.0/12 — RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 — RFC 1918
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 — loopback ::1 and link-local fe80::/10
  const lower = host.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    // fe80::/10 covers fe80 – febf
    const prefix = parseInt(lower.slice(0, 4), 16);
    if (prefix >= 0xfe80 && prefix <= 0xfebf) return true;
  }
  return false;
}

export async function fetchUrl(
  input: FetchUrlInput
): Promise<ToolResult<FetchUrlResult>> {
  const { url, headers = {}, timeout_ms = config.fetchTimeoutMs } = input;

  // Validate URL is HTTP/HTTPS only — explicitly reject file:, data:, javascript: etc.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: ${url}`, code: "INVALID_URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      ok: false,
      error: `Only http and https URLs are supported, got: ${parsed.protocol}`,
      code: "UNSUPPORTED_PROTOCOL",
    };
  }

  // Block private/loopback/link-local IPs — SSRF guard (H1)
  if (isPrivateIp(parsed.hostname)) {
    logger.warn("Blocked private IP request", { url, hostname: parsed.hostname });
    return {
      ok: false,
      error: `Requests to private or loopback addresses are not allowed: ${parsed.hostname}`,
      code: "PRIVATE_IP_BLOCKED",
    };
  }

  // Check blocked domains
  const hostname = parsed.hostname.toLowerCase();
  for (const blocked of config.fetchBlockedDomains) {
    if (hostname === blocked.toLowerCase() || hostname.endsWith(`.${blocked.toLowerCase()}`)) {
      logger.warn("Blocked domain request", { url, blocked });
      return {
        ok: false,
        error: `Domain is blocked: ${hostname}`,
        code: "DOMAIN_BLOCKED",
      };
    }
  }

  // Strip sensitive caller-supplied headers before forwarding (M1)
  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
      safeHeaders[key] = value;
    } else {
      logger.warn("Stripped blocked header from request", { header: key });
    }
  }

  logger.debug("Fetching URL", { url, timeout_ms });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": `${config.name}/${config.version} (MCP Server)`,
        Accept: "text/html,text/plain,application/json,*/*",
        ...safeHeaders,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    const contentType = response.headers.get("content-type") ?? "";
    const isText =
      contentType.startsWith("text/") ||
      contentType.includes("application/json") ||
      contentType.includes("application/xml") ||
      contentType.includes("application/javascript");

    if (!isText) {
      return {
        ok: false,
        error: `Content type not supported for text extraction: ${contentType}`,
        code: "UNSUPPORTED_CONTENT_TYPE",
      };
    }

    // Stream response up to the max byte limit
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, error: "Response body is empty", code: "EMPTY_BODY" };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > config.fetchMaxBytes) {
        truncated = true;
        // Only add the portion up to the limit
        const remaining = config.fetchMaxBytes - (totalBytes - value.byteLength);
        chunks.push(value.slice(0, remaining));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const body = chunks.map((c) => decoder.decode(c, { stream: true })).join("");

    logger.info("Fetch complete", {
      url,
      status: response.status,
      bytes: totalBytes,
      truncated,
    });

    return {
      ok: true,
      data: {
        url,
        status: response.status,
        content_type: contentType,
        body,
        truncated,
        fetched_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    clearTimeout(timer);

    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("Fetch timed out", { url, timeout_ms });
      return {
        ok: false,
        error: `Request timed out after ${timeout_ms}ms`,
        code: "TIMEOUT",
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error("Fetch failed", { url, error: message });
    return { ok: false, error: `Fetch failed: ${message}`, code: "FETCH_ERROR" };
  }
}
