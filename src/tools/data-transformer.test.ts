import { describe, expect, it } from "vitest";
import { transformData } from "./data-transformer.js";

describe("transformData", () => {
  // ─── JSON inputs ───────────────────────────────────────────────────────────

  describe("from JSON", () => {
    it("converts array of objects to CSV", async () => {
      const input = JSON.stringify([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ]);

      const result = await transformData({
        input,
        from_format: "json",
        to_format: "csv",
        options: { include_header: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.output).toContain("name,age");
      expect(result.data.output).toContain("Alice,30");
      expect(result.data.output).toContain("Bob,25");
      expect(result.data.rows_processed).toBe(2);
    });

    it("converts array of objects to markdown table", async () => {
      const input = JSON.stringify([
        { product: "Widget", price: 9.99 },
        { product: "Gadget", price: 19.99 },
      ]);

      const result = await transformData({
        input,
        from_format: "json",
        to_format: "markdown_table",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.output).toContain("| product");
      expect(result.data.output).toContain("Widget");
      expect(result.data.output).toContain("---");
    });

    it("converts flat object to key-value JSON", async () => {
      const input = JSON.stringify({ foo: "bar", baz: 42 });

      const result = await transformData({
        input,
        from_format: "json",
        to_format: "json",
        options: { pretty: false },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // flat object normalises to [{key, value}] rows
      expect(result.data.output).toContain("key");
      expect(result.data.output).toContain("foo");
    });

    it("returns error for invalid JSON", async () => {
      const result = await transformData({
        input: "{ not valid json",
        from_format: "json",
        to_format: "csv",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("PARSE_ERROR");
    });
  });

  // ─── CSV inputs ────────────────────────────────────────────────────────────

  describe("from CSV", () => {
    it("converts CSV to JSON", async () => {
      const input = "name,score\nAlice,95\nBob,88";

      const result = await transformData({
        input,
        from_format: "csv",
        to_format: "json",
        options: { pretty: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = JSON.parse(result.data.output) as unknown[];
      expect(parsed).toHaveLength(2);
      expect((parsed[0] as Record<string, string>).name).toBe("Alice");
    });

    it("converts CSV to TSV", async () => {
      const input = "a,b,c\n1,2,3";

      const result = await transformData({
        input,
        from_format: "csv",
        to_format: "tsv",
        options: { include_header: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.output).toContain("a\tb\tc");
      expect(result.data.output).toContain("1\t2\t3");
    });

    it("produces a text summary", async () => {
      const input = "col1,col2\nfoo,bar\nbaz,qux";

      const result = await transformData({
        input,
        from_format: "csv",
        to_format: "text_summary",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.output).toContain("2 rows");
      expect(result.data.output).toContain("col1, col2");
    });
  });

  // ─── Text inputs ───────────────────────────────────────────────────────────

  describe("from text", () => {
    it("converts plain text lines to JSON", async () => {
      const input = "line one\nline two\nline three";

      const result = await transformData({
        input,
        from_format: "text",
        to_format: "json",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = JSON.parse(result.data.output) as Array<{ line: string }>;
      expect(parsed).toHaveLength(3);
      expect(parsed[0].line).toBe("line one");
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  it("handles empty JSON array", async () => {
    const result = await transformData({
      input: "[]",
      from_format: "json",
      to_format: "csv",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows_processed).toBe(0);
  });

  it("rejects oversized input", async () => {
    // Config max is 50_000 chars in test environment — use a mock that exceeds it
    const bigInput = "x".repeat(100_001);

    const result = await transformData({
      input: bigInput,
      from_format: "text",
      to_format: "json",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INPUT_TOO_LARGE");
  });
});
