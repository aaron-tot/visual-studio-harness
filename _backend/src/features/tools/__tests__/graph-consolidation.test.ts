import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { graphTool } from "../consolidated/graph";
import { graphStatusTool } from "../builtins/graph_status";

const GRAPH_ACTIONS = [
  "search",
  "files",
  "info",
  "imports",
  "exports",
  "manifest",
  "status",
  "symbol_find",
  "symbol_read",
];

describe("graph tool consolidation", () => {
  it("registers a single consolidated 'graph' tool; old graph_*/find_symbol/read_symbol gone", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("graph");
    expect(names.filter((n) => n.startsWith("graph_"))).toEqual([]);
    expect(names).not.toContain("find_symbol");
    expect(names).not.toContain("read_symbol");
  });

  it("exposes all 9 action enum values (incl. symbol_find/symbol_read)", () => {
    const schema = graphTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(GRAPH_ACTIONS.sort());
  });

  it("requires action and rejects an unknown action", () => {
    const schema = graphTool.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ action: "search", name: "foo" }).success).toBe(true);
    expect(schema.safeParse({ action: "symbol_find", query: "foo" }).success).toBe(true);
    expect(schema.safeParse({ action: "symbol_read", name: "bar" }).success).toBe(true);
  });

  it("has all params optional plus required action (flat schema)", () => {
    const schema = graphTool.inputSchema as any;
    const shape = schema.shape;
    for (const [key, field] of Object.entries(shape)) {
      if (key === "action") continue;
      const typeName = field._def.typeName;
      const isOptional =
        typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault";
      expect(isOptional, `param '${key}' should be optional`).toBe(true);
    }
  });

  it("throw: unknown action produces an error result", async () => {
    const ctx: any = {
      graphService: null,
      dataDir: "/tmp",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    const res = await graphTool.execute({ action: "bogus" as any }, ctx);
    expect(res.isError).toBe(true);
  });

  it("dispatch: action forwards to the original tool with identical output", async () => {
    const ctx: any = {
      graphService: null,
      dataDir: "/tmp",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    const original = await graphStatusTool.execute({}, ctx);
    const consolidated = await graphTool.execute({ action: "status" }, ctx);

    expect(consolidated.output).toBe(original.output);
    expect(consolidated.isError).toBe(original.isError);
  });

  it("graph tool has permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const graph = registry.list().find((t) => t.name === "graph");
    expect(graph?.permissionDefault).toBe("allow");
  });
});
