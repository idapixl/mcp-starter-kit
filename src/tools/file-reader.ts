import * as fs from "fs/promises";
import * as path from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type {
  FileEntry,
  ListDirectoryInput,
  ListDirectoryResult,
  ReadFileInput,
  ReadFileResult,
  ToolResult,
} from "../types.js";

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MB

/**
 * Resolves a user-provided path against the configured root and checks that
 * the resolved absolute path stays within the root (path traversal guard).
 *
 * H2: On Windows, comparison is case-insensitive to prevent bypasses via
 * mixed-case paths (e.g. "C:\Root" vs "c:\root").
 */
function safePath(userPath: string): { resolved: string } | { error: string } {
  const root = path.resolve(config.fileReaderRoot);
  const resolved = path.resolve(root, userPath);

  // Normalize to lowercase on Windows to defeat case-sensitivity bypass (H2)
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;

  if (
    !normalizedResolved.startsWith(normalizedRoot + path.sep) &&
    normalizedResolved !== normalizedRoot
  ) {
    return {
      error: `Path traversal detected: "${userPath}" resolves outside the allowed root`,
    };
  }

  return { resolved };
}

/**
 * Reads a file within the configured root directory.
 */
export async function readFile(
  input: ReadFileInput
): Promise<ToolResult<ReadFileResult>> {
  const result = safePath(input.path);
  if ("error" in result) {
    return { ok: false, error: result.error, code: "PATH_TRAVERSAL" };
  }

  const { resolved } = result;
  const maxBytes = input.max_bytes ?? DEFAULT_MAX_BYTES;
  const encoding = input.encoding ?? "utf8";

  logger.debug("Reading file", { path: resolved, maxBytes, encoding });

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: `File not found: ${input.path}`, code: "NOT_FOUND" };
    }
    return {
      ok: false,
      error: `Cannot stat file: ${(err as Error).message}`,
      code: "STAT_ERROR",
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      error: `Path is not a file: ${input.path}`,
      code: "NOT_A_FILE",
    };
  }

  const truncated = stat.size > maxBytes;
  const bytesToRead = Math.min(stat.size, maxBytes);

  let content: string;
  try {
    const handle = await fs.open(resolved, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, 0);
      content =
        encoding === "base64"
          ? buffer.toString("base64")
          : buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read file: ${(err as Error).message}`,
      code: "READ_ERROR",
    };
  }

  logger.info("File read", { path: input.path, bytes: bytesToRead, truncated });

  return {
    ok: true,
    data: {
      path: input.path,
      size_bytes: stat.size,
      encoding,
      content,
      truncated,
      read_at: new Date().toISOString(),
    },
  };
}

/**
 * Lists files and directories within the configured root directory.
 */
export async function listDirectory(
  input: ListDirectoryInput
): Promise<ToolResult<ListDirectoryResult>> {
  const userPath = input.path ?? ".";
  const result = safePath(userPath);
  if ("error" in result) {
    return { ok: false, error: result.error, code: "PATH_TRAVERSAL" };
  }

  const { resolved } = result;

  // M2: Apply depth/entry caps with defaults from schema
  const maxDepth = input.max_depth ?? 3;
  const maxEntries = input.max_entries ?? 10000;

  logger.debug("Listing directory", {
    path: resolved,
    recursive: input.recursive,
    maxDepth,
    maxEntries,
  });

  const counter = { count: 0, truncated: false };

  let entries: FileEntry[];
  try {
    entries = await collectEntries(
      resolved,
      userPath,
      input.recursive ?? false,
      0,
      maxDepth,
      maxEntries,
      counter
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error: `Directory not found: ${userPath}`,
        code: "NOT_FOUND",
      };
    }
    if (code === "ENOTDIR") {
      return {
        ok: false,
        error: `Path is not a directory: ${userPath}`,
        code: "NOT_A_DIRECTORY",
      };
    }
    return {
      ok: false,
      error: `Failed to list directory: ${(err as Error).message}`,
      code: "LIST_ERROR",
    };
  }

  return {
    ok: true,
    data: {
      path: userPath,
      entries,
      total: entries.length,
      ...(counter.truncated ? { truncated: true } : {}),
    } as ListDirectoryResult,
  };
}

async function collectEntries(
  absoluteDir: string,
  relativeDir: string,
  recursive: boolean,
  currentDepth: number,
  maxDepth: number,
  maxEntries: number,
  counter: { count: number; truncated: boolean }
): Promise<FileEntry[]> {
  const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
  const results: FileEntry[] = [];

  for (const dirent of dirents) {
    // M2: bail when entry cap is reached
    if (counter.count >= maxEntries) {
      counter.truncated = true;
      break;
    }

    const entryRelPath = path.posix.join(relativeDir, dirent.name);
    const entryAbsPath = path.join(absoluteDir, dirent.name);

    if (dirent.isDirectory()) {
      results.push({ name: dirent.name, path: entryRelPath, type: "directory" });
      counter.count++;

      // M2: only recurse if within depth limit
      if (recursive && currentDepth < maxDepth - 1) {
        const children = await collectEntries(
          entryAbsPath,
          entryRelPath,
          true,
          currentDepth + 1,
          maxDepth,
          maxEntries,
          counter
        );
        results.push(...children);
      }
    } else if (dirent.isFile()) {
      let size_bytes: number | undefined;
      let modified_at: string | undefined;
      try {
        const s = await fs.stat(entryAbsPath);
        size_bytes = s.size;
        modified_at = s.mtime.toISOString();
      } catch {
        // Stat failure is non-fatal — entry is still listed
      }
      results.push({
        name: dirent.name,
        path: entryRelPath,
        type: "file",
        size_bytes,
        modified_at,
      });
      counter.count++;
    }
  }

  return results;
}
