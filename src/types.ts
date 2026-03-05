import { z } from "zod";

// ─── Tool Result Types ────────────────────────────────────────────────────────

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface ToolError {
  ok: false;
  error: string;
  code?: string;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

// ─── MCP Content Helpers ──────────────────────────────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type McpContent = TextContent | ImageContent;

// ─── Web Fetcher Types ────────────────────────────────────────────────────────

export const FetchUrlSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  headers: z.record(z.string()).optional().describe("Optional HTTP headers"),
  timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(30000)
    .optional()
    .describe("Request timeout in milliseconds (100–30000)"),
});

export type FetchUrlInput = z.infer<typeof FetchUrlSchema>;

export interface FetchUrlResult {
  url: string;
  status: number;
  content_type: string;
  body: string;
  truncated: boolean;
  fetched_at: string;
}

// ─── File Reader Types ────────────────────────────────────────────────────────

export const ReadFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path to the file, relative to the configured root directory"),
  encoding: z
    .enum(["utf8", "base64"])
    .optional()
    .default("utf8")
    .describe("File encoding — use base64 for binary files"),
  max_bytes: z
    .number()
    .int()
    .min(1)
    .max(10_485_760)
    .optional()
    .describe("Maximum bytes to read (default: 1MB, max: 10MB)"),
});

export type ReadFileInput = z.infer<typeof ReadFileSchema>;

export interface ReadFileResult {
  path: string;
  size_bytes: number;
  encoding: string;
  content: string;
  truncated: boolean;
  read_at: string;
}

export const ListDirectorySchema = z.object({
  path: z
    .string()
    .optional()
    .default(".")
    .describe("Directory path relative to the configured root"),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to list files recursively"),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe("Maximum directory depth for recursive listing (default: 3, max: 10)"),
  max_entries: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(10000)
    .describe("Maximum total entries to return (default: 10000)"),
});

export type ListDirectoryInput = z.infer<typeof ListDirectorySchema>;

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size_bytes?: number;
  modified_at?: string;
}

export interface ListDirectoryResult {
  path: string;
  entries: FileEntry[];
  total: number;
}

// ─── Data Transformer Types ───────────────────────────────────────────────────

export const TransformDataSchema = z.object({
  input: z.string().min(1).describe("The raw input data to transform"),
  from_format: z
    .enum(["json", "csv", "tsv", "text"])
    .describe("Input data format"),
  to_format: z
    .enum(["json", "csv", "tsv", "markdown_table", "text_summary"])
    .describe("Desired output format"),
  options: z
    .object({
      pretty: z
        .boolean()
        .optional()
        .default(true)
        .describe("Pretty-print JSON output"),
      include_header: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include header row in CSV/TSV output"),
      delimiter: z
        .string()
        .max(1)
        .optional()
        .describe("Custom delimiter for CSV/TSV parsing"),
    })
    .optional()
    .default({}),
});

export type TransformDataInput = z.infer<typeof TransformDataSchema>;

export interface TransformDataResult {
  input_format: string;
  output_format: string;
  output: string;
  rows_processed?: number;
  transformed_at: string;
}

// ─── Config Types ─────────────────────────────────────────────────────────────

export interface ServerConfig {
  name: string;
  version: string;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  fetchBlockedDomains: string[];
  fileReaderRoot: string;
  transformerMaxInput: number;
  logLevel: "debug" | "info" | "warn" | "error";
}
