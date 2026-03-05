# MCP Server Starter Kit

A production-ready TypeScript template for building Model Context Protocol (MCP) servers. Skip the boilerplate and ship working tools to Claude and other MCP clients in minutes.

## What's included

- **Working MCP server** using the official `@modelcontextprotocol/sdk`
- **3 example tools** you can use as-is or adapt:
  - `fetch_url` — fetch web content with configurable limits and domain blocking
  - `read_file` / `list_directory` — safe filesystem access with path traversal protection
  - `transform_data` — convert between JSON, CSV, TSV, Markdown table, and plain text
- **TypeScript throughout** — strict mode, typed inputs/outputs, Zod validation
- **Error handling patterns** — every tool returns a typed `ToolResult<T>` with ok/error discrimination
- **Environment-based config** — all limits and paths configurable via `.env`
- **Structured logging** — stderr-only logger (MCP protocol uses stdout)
- **Test suite** — 19 tests with Vitest covering all three tools
- **Build scripts** — `npm run build`, `npm run dev`, `npm test`, `npm run typecheck`

## Requirements

- Node.js 18 or higher
- npm 9 or higher

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum, set FILE_READER_ROOT to a safe directory

# 3. Build
npm run build

# 4. Run
npm start
```

## Development mode

```bash
npm run dev
```

Uses `tsx` for live reload — no build step required during development.

## Connect to Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-starter-kit/dist/index.js"],
      "env": {
        "FILE_READER_ROOT": "/path/to/allowed/directory",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Restart Claude Desktop. Your tools will appear in the tool picker.

## Connect to Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-starter-kit/dist/index.js"]
    }
  }
}
```

## Tools reference

### fetch_url

Fetches the text content of a URL.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | HTTP or HTTPS URL to fetch |
| `headers` | object | no | Additional request headers |
| `timeout_ms` | number | no | Request timeout (100–30000ms, default from env) |

Returns the response body, status code, content type, and a `truncated` flag if the response exceeded `FETCH_MAX_BYTES`.

### read_file

Reads a file within the configured `FILE_READER_ROOT`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Relative path from root |
| `encoding` | `utf8` or `base64` | no | Encoding (default: utf8) |
| `max_bytes` | number | no | Max bytes to read (default: 1MB) |

Path traversal (`../`) is blocked at the resolver level.

### list_directory

Lists files and directories within the configured root.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Relative directory path (default: `.`) |
| `recursive` | boolean | no | List nested files (default: false) |

### transform_data

Converts data between formats.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | string | yes | Raw input data |
| `from_format` | `json\|csv\|tsv\|text` | yes | Input format |
| `to_format` | `json\|csv\|tsv\|markdown_table\|text_summary` | yes | Output format |
| `options.pretty` | boolean | no | Pretty-print JSON (default: true) |
| `options.include_header` | boolean | no | Include CSV/TSV header row (default: true) |
| `options.delimiter` | string | no | Custom delimiter for CSV/TSV parsing |

## Configuration

All configuration is via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_NAME` | `mcp-starter-kit` | Server identity reported to clients |
| `SERVER_VERSION` | `1.0.0` | Server version |
| `FETCH_MAX_BYTES` | `1048576` | Max response size for web fetcher (bytes) |
| `FETCH_TIMEOUT_MS` | `10000` | Default fetch timeout (ms) |
| `FETCH_BLOCKED_DOMAINS` | _(empty)_ | Comma-separated blocked hostnames |
| `FILE_READER_ROOT` | `./workspace` | Root directory for file access |
| `TRANSFORMER_MAX_INPUT` | `50000` | Max input characters for transformer |
| `LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |

## Adding your own tools

1. Create `src/tools/my-tool.ts` — export an async function that returns `ToolResult<YourType>`
2. Add input/output types to `src/types.ts` using Zod schemas
3. Register the tool in `src/index.ts` with `server.tool(name, description, schema, handler)`
4. Write tests in `src/tools/my-tool.test.ts`

The pattern used by all three example tools:

```typescript
export async function myTool(input: MyToolInput): Promise<ToolResult<MyToolOutput>> {
  // validate, execute, return { ok: true, data: ... } or { ok: false, error: "...", code: "..." }
}
```

## Project structure

```
mcp-starter-kit/
├── src/
│   ├── index.ts          # Server entry point — tool registration
│   ├── config.ts         # Environment variable loading
│   ├── logger.ts         # Stderr logger
│   ├── types.ts          # Shared types and Zod schemas
│   └── tools/
│       ├── web-fetcher.ts
│       ├── web-fetcher.test.ts (add your own)
│       ├── file-reader.ts
│       ├── file-reader.test.ts
│       ├── data-transformer.ts
│       └── data-transformer.test.ts
├── dist/                 # Compiled output (after npm run build)
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Running tests

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

## License

MIT
