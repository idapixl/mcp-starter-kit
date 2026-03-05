import { config } from "../config.js";
import { logger } from "../logger.js";
import type {
  TransformDataInput,
  TransformDataResult,
  ToolResult,
} from "../types.js";

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
}

function parseCsvOrTsv(
  input: string,
  delimiter: string
): { headers: string[]; rows: string[][] } {
  const lines = input.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("Input is empty");

  const split = (line: string): string[] =>
    line.split(delimiter).map((cell) => cell.trim());

  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);

  return { headers, rows };
}

function parseText(input: string): string[] {
  return input.trim().split(/\r?\n/);
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

/** Normalises any parsed input into a common tabular form: headers + rows. */
function normalise(
  parsed: unknown,
  fromFormat: string
): { headers: string[]; rows: string[][] } {
  if (fromFormat === "json") {
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return { headers: [], rows: [] };
      if (typeof parsed[0] === "object" && parsed[0] !== null) {
        const headers = Object.keys(parsed[0] as Record<string, unknown>);
        const rows = (parsed as Record<string, unknown>[]).map((item) =>
          headers.map((h) => String(item[h] ?? ""))
        );
        return { headers, rows };
      }
      // Array of primitives
      return {
        headers: ["value"],
        rows: parsed.map((v) => [String(v)]),
      };
    }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        headers: ["key", "value"],
        rows: Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]),
      };
    }
    return { headers: ["value"], rows: [[String(parsed)]] };
  }

  if (fromFormat === "csv" || fromFormat === "tsv") {
    return parsed as { headers: string[]; rows: string[][] };
  }

  if (fromFormat === "text") {
    return {
      headers: ["line"],
      rows: (parsed as string[]).map((l) => [l]),
    };
  }

  throw new Error(`Unknown from_format: ${fromFormat}`);
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function toJson(
  data: { headers: string[]; rows: string[][] },
  pretty: boolean
): string {
  const objects = data.rows.map((row) =>
    Object.fromEntries(data.headers.map((h, i) => [h, row[i] ?? ""]))
  );
  return JSON.stringify(objects, null, pretty ? 2 : undefined);
}

function toCsvOrTsv(
  data: { headers: string[]; rows: string[][] },
  delimiter: string,
  includeHeader: boolean
): string {
  const join = (cells: string[]): string =>
    cells
      .map((c) => {
        // Quote cells that contain the delimiter, quotes, or newlines
        if (c.includes(delimiter) || c.includes('"') || c.includes("\n")) {
          return `"${c.replace(/"/g, '""')}"`;
        }
        return c;
      })
      .join(delimiter);

  const lines: string[] = [];
  if (includeHeader && data.headers.length > 0) {
    lines.push(join(data.headers));
  }
  for (const row of data.rows) {
    lines.push(join(row));
  }
  return lines.join("\n");
}

function toMarkdownTable(data: { headers: string[]; rows: string[][] }): string {
  if (data.headers.length === 0) return "_Empty table_";

  const widths = data.headers.map((h, i) => {
    const cellWidths = data.rows.map((r) => (r[i] ?? "").length);
    return Math.max(h.length, ...cellWidths, 3);
  });

  const pad = (s: string, w: number): string => s.padEnd(w);
  const separator = widths.map((w) => "-".repeat(w)).join(" | ");
  const header = data.headers.map((h, i) => pad(h, widths[i])).join(" | ");

  const lines = [
    `| ${header} |`,
    `| ${separator} |`,
    ...data.rows.map(
      (row) =>
        `| ${row.map((cell, i) => pad(cell ?? "", widths[i])).join(" | ")} |`
    ),
  ];

  return lines.join("\n");
}

function toTextSummary(data: { headers: string[]; rows: string[][] }): string {
  const rowCount = data.rows.length;
  const colCount = data.headers.length;

  const lines: string[] = [
    `Dataset: ${rowCount} row${rowCount !== 1 ? "s" : ""}, ${colCount} column${colCount !== 1 ? "s" : ""}`,
    `Columns: ${data.headers.join(", ")}`,
  ];

  if (rowCount > 0) {
    lines.push("", "First 3 rows:");
    data.rows.slice(0, 3).forEach((row, i) => {
      const cells = data.headers
        .map((h, j) => `  ${h}: ${row[j] ?? ""}`)
        .join("\n");
      lines.push(`Row ${i + 1}:\n${cells}`);
    });
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function transformData(
  input: TransformDataInput
): Promise<ToolResult<TransformDataResult>> {
  const { from_format, to_format } = input;
  const options = input.options ?? {};
  const pretty = options.pretty ?? true;
  const include_header = options.include_header ?? true;
  const delimiter = options.delimiter;

  if (input.input.length > config.transformerMaxInput) {
    return {
      ok: false,
      error: `Input exceeds maximum size of ${config.transformerMaxInput} characters`,
      code: "INPUT_TOO_LARGE",
    };
  }

  logger.debug("Transforming data", { from_format, to_format });

  // Determine actual delimiters
  const inputDelimiter = delimiter ?? (from_format === "tsv" ? "\t" : ",");
  const outputDelimiter = to_format === "tsv" ? "\t" : ",";

  let parsed: unknown;
  try {
    if (from_format === "json") {
      parsed = parseJson(input.input);
    } else if (from_format === "csv" || from_format === "tsv") {
      parsed = parseCsvOrTsv(input.input, inputDelimiter);
    } else {
      parsed = parseText(input.input);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse input as ${from_format}: ${(err as Error).message}`,
      code: "PARSE_ERROR",
    };
  }

  let normalised: { headers: string[]; rows: string[][] };
  try {
    normalised = normalise(parsed, from_format);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to normalise data: ${(err as Error).message}`,
      code: "NORMALISE_ERROR",
    };
  }

  let output: string;
  try {
    switch (to_format) {
      case "json":
        output = toJson(normalised, pretty);
        break;
      case "csv":
        output = toCsvOrTsv(normalised, ",", include_header);
        break;
      case "tsv":
        output = toCsvOrTsv(normalised, outputDelimiter, include_header);
        break;
      case "markdown_table":
        output = toMarkdownTable(normalised);
        break;
      case "text_summary":
        output = toTextSummary(normalised);
        break;
      default:
        return {
          ok: false,
          error: `Unknown to_format: ${to_format as string}`,
          code: "UNKNOWN_FORMAT",
        };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to format output as ${to_format}: ${(err as Error).message}`,
      code: "FORMAT_ERROR",
    };
  }

  logger.info("Transform complete", {
    from_format,
    to_format,
    rows: normalised.rows.length,
  });

  return {
    ok: true,
    data: {
      input_format: from_format,
      output_format: to_format,
      output,
      rows_processed: normalised.rows.length,
      transformed_at: new Date().toISOString(),
    },
  };
}
