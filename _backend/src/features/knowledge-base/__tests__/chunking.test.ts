import { describe, it, expect } from "bun:test";
import { chunkDocument } from "../chunking";

describe("chunkDocument", () => {
  it("chunks markdown by heading boundaries", () => {
    const content = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "## Section A",
      "",
      "Content in section A.",
      "",
      "### Subsection A1",
      "",
      "Deeper content.",
      "",
      "## Section B",
      "",
      "Content in section B.",
    ].join("\n");

    const chunks = chunkDocument("test.md", content);
    expect(chunks.length).toBe(4);
    expect(chunks[0].section).toBe("Title");
    expect(chunks[0].content).toContain("Intro paragraph.");
    expect(chunks[1].section).toBe("Title > Section A");
    expect(chunks[1].content).toContain("Content in section A.");
    expect(chunks[2].section).toBe("Title > Section A > Subsection A1");
    expect(chunks[2].content).toContain("Deeper content.");
    expect(chunks[3].section).toBe("Title > Section B");
  });

  it("does not split inside code fences", () => {
    const content = [
      "# API Docs",
      "",
      "```ts",
      "function foo() {",
      "  // # This looks like a heading but is inside a fence",
      "  return 42;",
      "}",
      "```",
      "",
      "## Endpoint",
      "",
      "The /api/foo endpoint.",
    ].join("\n");

    const chunks = chunkDocument("test.md", content);
    // Should be 2 chunks: one with code fence, one after
    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain("```ts");
    expect(chunks[0].content).toContain("return 42");
    expect(chunks[1].section).toBe("API Docs > Endpoint");
  });

  it("does not split inside markdown tables", () => {
    const content = [
      "# Data Table",
      "",
      "| Col A | Col B |",
      "|-------|-------|",
      "| Val 1 | Val 2 |",
      "| ## Not a heading | More |",
    ].join("\n");

    const chunks = chunkDocument("test.md", content);
    // Single chunk since table is first content
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("Col A");
    expect(chunks[0].content).toContain("## Not a heading");
  });

  it("handles plain text as single chunk", () => {
    const content = "Line one\nLine two\nLine three";
    const chunks = chunkDocument("file.txt", content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].section).toBe("Document");
    expect(chunks[0].content).toBe("Line one\nLine two\nLine three");
  });

  it("computes hash and token count for each chunk", () => {
    const content = "# Hello\n\nWorld.";
    const chunks = chunkDocument("test.md", content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].hash).toBeTruthy();
    expect(chunks[0].hash.length).toBe(64); // SHA-256 hex
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
    // tokenCount = content.length / 4, rounded
    expect(chunks[0].tokenCount).toBe(Math.max(1, Math.round(chunks[0].content.length / 4)));
  });

  it("returns empty chunk for empty content", () => {
    const chunks = chunkDocument("test.md", "");
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("");
  });

  it("handles markdown without headings", () => {
    const content = "Just a paragraph.\n\nAnother paragraph.";
    const chunks = chunkDocument("test.md", content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].section).toBe("Document");
  });

  it("trims whitespace from chunk content", () => {
    const content = "  \n# Heading\n\n  Some content with spaces.  \n\n\n";
    const chunks = chunkDocument("test.md", content);
    // The chunker creates 2 chunks: empty from intro, then heading content
    const last = chunks[chunks.length - 1];
    expect(last.content).not.toMatch(/^\s/);
    expect(last.content).not.toMatch(/\s$/);
  });
});
