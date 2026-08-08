import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { auditTool } from "../consolidated/audit";
import { auditPromptListTool } from "../builtins/audit_prompt_list";

const AUDIT_ACTIONS = [
  "create",
  "read",
  "edit",
  "delete",
  "move",
  "prompt_create",
  "prompt_list",
  "prompt_read",
  "prompt_edit",
  "prompt_delete",
];

describe("audit tool consolidation", () => {
  it("registers a single consolidated 'audit' tool instead of 9 individual audit tools", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const names = tools.map((t) => t.name);

    expect(names).toContain("audit");
    const oldAudit = names.filter((n) => n.startsWith("audit_"));
    expect(oldAudit).toEqual([]);
  });

  it("exposes all 9 action enum values", () => {
    const schema = auditTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(AUDIT_ACTIONS.sort());
  });

  it("requires action and rejects an unknown action", () => {
    const schema = auditTool.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ action: "read" }).success).toBe(true);
  });

  it("has all params optional plus required action (flat schema)", () => {
    const schema = auditTool.inputSchema as any;
    const shape = schema.shape;
    for (const [key, field] of Object.entries(shape)) {
      if (key === "action") continue;
      const isOptional =
        field._def.typeName === "ZodOptional" ||
        field._def.typeName === "ZodNullable" ||
        field._def.typeName === "ZodDefault";
      expect(isOptional, `param '${key}' should be optional`).toBe(true);
    }
  });

  it("dispatch: prompt_list via consolidated tool matches the original tool output", async () => {
    const ctx: any = {
      dataDir: "/tmp/opencode/audit-data",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    const original = await auditPromptListTool.execute({}, ctx);
    const consolidated = await auditTool.execute({ action: "prompt_list" }, ctx);

    expect(original.output).toBe(consolidated.output);
    expect(consolidated.metadata).toEqual(original.metadata);
  });

  it("audit tool has permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const audit = registry.list().find((t) => t.name === "audit");
    expect(audit?.permissionDefault).toBe("allow");
  });
});
