import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { knowledgeTool } from "../consolidated/knowledge";
import { knowledgeIngestTool } from "../builtins/knowledge_ingest";

const KNOWLEDGE_ACTIONS = [
  "search",
  "open",
  "ingest",
  "doc_create",
  "doc_edit",
  "doc_delete",
];

describe("knowledge tool consolidation", () => {
  it("registers a single consolidated 'knowledge' tool instead of 6 individual knowledge tools", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("knowledge");
    expect(names.filter((n) => n.startsWith("knowledge_"))).toEqual([]);
  });

  it("exposes all 6 action enum values", () => {
    const schema = knowledgeTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(KNOWLEDGE_ACTIONS.sort());
  });

  it("requires action and rejects an unknown action", () => {
    const schema = knowledgeTool.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ action: "search", query: "foo" }).success).toBe(true);
  });

  it("has all params optional plus required action (flat schema)", () => {
    const schema = knowledgeTool.inputSchema as any;
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
      dataDir: "/tmp",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    const res = await knowledgeTool.execute({ action: "bogus" as any }, ctx);
    expect(res.isError).toBe(true);
  });

  it("dispatch: action forwards to the original tool with identical behavior", async () => {
    const ctx: any = {
      dataDir: "/tmp",
      sessionId: "s",
      workspaceRoot: "/tmp",
      abortSignal: null,
      callId: "c",
      askPermission: async () => true,
      hookCtx: undefined,
    };
    let originalResult: ToolResult | undefined;
    let originalError: Error | undefined;
    let consolidatedResult: ToolResult | undefined;
    let consolidatedError: Error | undefined;

    try {
      originalResult = await knowledgeIngestTool.execute({ scope: "global" }, ctx);
    } catch (e) {
      originalError = e as Error;
    }

    try {
      consolidatedResult = await knowledgeTool.execute({ action: "ingest", scope: "global" }, ctx);
    } catch (e) {
      consolidatedError = e as Error;
    }

    // Both should throw the same "service not initialized" error
    expect(originalError).toBeDefined();
    expect(consolidatedError).toBeDefined();
    expect(originalError!.message).toBe(consolidatedError!.message);
    expect(originalResult).toBeUndefined();
    expect(consolidatedResult).toBeUndefined();
  });

  it("knowledge tool has permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const knowledge = registry.list().find((t) => t.name === "knowledge");
    expect(knowledge?.permissionDefault).toBe("allow");
  });
});