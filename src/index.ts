import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  FetchUrlSchema,
  ListDirectorySchema,
  ReadFileSchema,
  TransformDataSchema,
} from "./types.js";

import { fetchUrl } from "./tools/web-fetcher.js";
import { listDirectory, readFile } from "./tools/file-reader.js";
import { transformData } from "./tools/data-transformer.js";

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: config.name,
  version: config.version,
});

// ─── Tool: fetch_url ──────────────────────────────────────────────────────────

server.tool(
  "fetch_url",
  "Fetch the content of a URL and return it as text. Supports HTTP and HTTPS. " +
    "Returns the response body, status code, and content type. " +
    "Binary content (images, PDFs, etc.) is rejected — text and JSON only.",
  FetchUrlSchema.shape,
  async (args) => {
    const result = await fetchUrl(args);

    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error [${result.code}]: ${result.error}` }],
      };
    }

    const { data } = result;
    const truncationNote = data.truncated
      ? `\n\n[Content truncated — response exceeded ${config.fetchMaxBytes} bytes]`
      : "";

    const summary =
      `URL: ${data.url}\n` +
      `Status: ${data.status}\n` +
      `Content-Type: ${data.content_type}\n` +
      `Fetched: ${data.fetched_at}\n` +
      `---\n` +
      data.body +
      truncationNote;

    return { content: [{ type: "text", text: summary }] };
  }
);

// ─── Tool: read_file ──────────────────────────────────────────────────────────

server.tool(
  "read_file",
  `Read a file from the filesystem. Paths are relative to the configured root directory (${config.fileReaderRoot}). ` +
    "Path traversal (../) is blocked. " +
    "Use encoding=base64 for binary files.",
  ReadFileSchema.shape,
  async (args) => {
    const result = await readFile(args);

    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error [${result.code}]: ${result.error}` }],
      };
    }

    const { data } = result;
    const truncationNote = data.truncated
      ? `\n\n[Content truncated — file is ${data.size_bytes} bytes but only ${args.max_bytes ?? 1_048_576} bytes were read]`
      : "";

    const output =
      data.encoding === "base64"
        ? `File: ${data.path} (${data.size_bytes} bytes, base64)\n---\n${data.content}`
        : data.content + truncationNote;

    return { content: [{ type: "text", text: output }] };
  }
);

// ─── Tool: list_directory ─────────────────────────────────────────────────────

server.tool(
  "list_directory",
  `List files and directories. Paths are relative to the configured root (${config.fileReaderRoot}). ` +
    "Set recursive=true to list all nested files.",
  ListDirectorySchema.shape,
  async (args) => {
    const result = await listDirectory(args);

    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error [${result.code}]: ${result.error}` }],
      };
    }

    const { data } = result;

    if (data.entries.length === 0) {
      return {
        content: [{ type: "text", text: `Directory "${data.path}" is empty.` }],
      };
    }

    const lines = data.entries.map((entry) => {
      const icon = entry.type === "directory" ? "DIR " : "FILE";
      const size =
        entry.size_bytes !== undefined ? ` (${entry.size_bytes} bytes)` : "";
      return `${icon}  ${entry.path}${size}`;
    });

    const output =
      `Directory: ${data.path}\n` +
      `Total: ${data.total} entries\n` +
      `---\n` +
      lines.join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// ─── Tool: transform_data ─────────────────────────────────────────────────────

server.tool(
  "transform_data",
  "Convert data between formats: JSON, CSV, TSV, Markdown table, and plain text summary. " +
    "Useful for reformatting API responses, preparing data for display, or normalising spreadsheet exports.",
  TransformDataSchema.shape,
  async (args) => {
    const result = await transformData(args);

    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error [${result.code}]: ${result.error}` }],
      };
    }

    const { data } = result;
    const rowNote =
      data.rows_processed !== undefined
        ? ` (${data.rows_processed} rows processed)`
        : "";

    const header =
      `Transformed: ${data.input_format} → ${data.output_format}${rowNote}\n` +
      `---\n`;

    return { content: [{ type: "text", text: header + data.output }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info(`Starting ${config.name} v${config.version}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP server connected and ready");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
