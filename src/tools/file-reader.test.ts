import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to override config before importing the module under test
vi.mock("../config.js", () => ({
  config: {
    name: "test-server",
    version: "0.0.0",
    fetchMaxBytes: 1_048_576,
    fetchTimeoutMs: 5_000,
    fetchBlockedDomains: [],
    fileReaderRoot: "", // will be set per-test in beforeEach
    transformerMaxInput: 50_000,
    logLevel: "error",
  },
}));

import { config } from "../config.js";
import { listDirectory, readFile } from "./file-reader.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
  // Point the mocked config at our temp directory
  (config as { fileReaderRoot: string }).fileReaderRoot = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("readFile", () => {
  it("reads an existing file", async () => {
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "hello world");

    const result = await readFile({ path: "hello.txt", encoding: "utf8" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content).toBe("hello world");
    expect(result.data.size_bytes).toBe(11);
    expect(result.data.truncated).toBe(false);
  });

  it("returns NOT_FOUND for missing file", async () => {
    const result = await readFile({ path: "nope.txt", encoding: "utf8" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("blocks path traversal", async () => {
    const result = await readFile({ path: "../../etc/passwd", encoding: "utf8" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PATH_TRAVERSAL");
  });

  it("truncates file content when max_bytes is set", async () => {
    await fs.writeFile(path.join(tmpDir, "big.txt"), "a".repeat(100));

    const result = await readFile({
      path: "big.txt",
      encoding: "utf8",
      max_bytes: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content.length).toBe(10);
    expect(result.data.truncated).toBe(true);
  });

  it("reads a file as base64", async () => {
    await fs.writeFile(path.join(tmpDir, "data.bin"), Buffer.from([0x00, 0xff, 0x42]));

    const result = await readFile({ path: "data.bin", encoding: "base64" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.encoding).toBe("base64");
    expect(result.data.content).toBe(Buffer.from([0x00, 0xff, 0x42]).toString("base64"));
  });
});

describe("listDirectory", () => {
  it("lists files in the root", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "");

    const result = await listDirectory({ path: ".", recursive: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(2);
    expect(result.data.entries.map((e) => e.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("lists recursively", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(path.join(tmpDir, "top.txt"), "");
    await fs.writeFile(path.join(tmpDir, "sub", "nested.txt"), "");

    const result = await listDirectory({ path: ".", recursive: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.data.entries.map((e) => e.name);
    expect(names).toContain("top.txt");
    expect(names).toContain("nested.txt");
    expect(names).toContain("sub");
  });

  it("returns NOT_FOUND for missing directory", async () => {
    const result = await listDirectory({ path: "ghost-dir", recursive: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("blocks path traversal in directory listing", async () => {
    const result = await listDirectory({ path: "../../", recursive: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PATH_TRAVERSAL");
  });
});
