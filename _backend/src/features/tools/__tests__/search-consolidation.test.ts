import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { searchLocalTool } from "../consolidated/searchLocal";
import { searchOnlineTool } from "../consolidated/searchOnline";

describe("searchLocal consolidation (grep + glob)", () => {
  it("registers a single searchLocal tool instead of grep/glob", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("searchLocal");
    expect(names).not.toContain("grep");
    expect(names).not.toContain("glob");
  });

  it("exposes grep/glob actions", () => {
    const schema = searchLocalTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(["glob", "grep"]);

    expect(schema.safeParse({ action: "grep", pattern: "x" }).success).toBe(true);
    expect(schema.safeParse({ action: "glob", pattern: "*.ts" }).success).toBe(true);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
  });
});

describe("searchOnline consolidation (websearch + webfetch)", () => {
  it("registers a single searchOnline tool instead of websearch/webfetch", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("searchOnline");
    expect(names).not.toContain("websearch");
    expect(names).not.toContain("webfetch");
  });

  it("exposes search/fetch actions", () => {
    const schema = searchOnlineTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(["fetch", "search"]);

    expect(schema.safeParse({ action: "search", query: "x" }).success).toBe(true);
    expect(schema.safeParse({ action: "fetch", url: "https://a.com" }).success).toBe(true);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
  });
});
