import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { designTool } from "../consolidated/design";

const DESIGN_ACTIONS = ["create", "read", "edit", "abandon"];

describe("design tool consolidation", () => {
  it("registers a single consolidated 'design' tool instead of 4 individual design tools", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("design");
    expect(names.filter((n) => n.startsWith("design_"))).toEqual([]);
  });

  it("notes_list is removed (list feature=notes covers it)", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);
    expect(names).not.toContain("notes_list");
  });

  it("exposes all 4 action enum values", () => {
    const schema = designTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(DESIGN_ACTIONS.sort());
  });

  it("requires action and rejects an unknown action", () => {
    const schema = designTool.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ action: "read", name: "x", type: "spec" }).success).toBe(true);
  });

  it("has all params optional plus required action (flat schema)", () => {
    const schema = designTool.inputSchema as any;
    const shape = schema.shape;
    for (const [key, field] of Object.entries(shape)) {
      if (key === "action") continue;
      const typeName = field._def.typeName;
      expect(
        typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault",
        `param '${key}' should be optional`,
      ).toBe(true);
    }
  });

  it("throw: unknown action produces an error result", async () => {
    const ctx: any = {
      dataDir: "/tmp",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    const res = await designTool.execute({ action: "bogus" as any }, ctx);
    expect(res.isError).toBe(true);
  });

  it("design tool has permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const design = registry.list().find((t) => t.name === "design");
    expect(design?.permissionDefault).toBe("allow");
  });
});
