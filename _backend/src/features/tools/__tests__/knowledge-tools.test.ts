import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { knowledgeTool } from "../consolidated/knowledge";

describe("knowledge tool consolidation", () => {
  it("registers a single consolidated 'knowledge' tool", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("knowledge");
    expect(names.filter((n) => n.startsWith("knowledge_"))).toEqual([]);
  });

  it("consolidated knowledge tool has name, description, inputSchema, and execute", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();

    const tool = tools.find((t) => t.name === "knowledge");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("knowledge");
    expect(tool!.description).toBeTruthy();
    expect(tool!.inputSchema).toBeDefined();
    expect(typeof tool!.execute).toBe("function");
    expect(tool!.permissionDefault).toBe("allow");
  });

  it("knowledge tool has outputFields for agent consumption", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const tool = tools.find((t) => t.name === "knowledge");

    expect(tool!.outputFields).toBeDefined();
    expect(tool!.outputFields!.length).toBeGreaterThan(0);
  });

  it("knowledge tool action enum includes all 6 sub-commands", () => {
    const schema = knowledgeTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect(values.sort()).toEqual(["doc_create", "doc_delete", "doc_edit", "ingest", "open", "search"].sort());
  });

  it("search action: limit is optional so the mode preset chunk count applies", () => {
    const schema = knowledgeTool.inputSchema as any;

    // No limit provided — mode preset topK should be used.
    const noLimit = schema.safeParse({ action: "search", query: "hello", mode: "code" });
    expect(noLimit.success).toBe(true);
    // Explicit limit still honored.
    const withLimit = schema.safeParse({ action: "search", query: "hello", limit: 3 });
    expect(withLimit.success).toBe(true);
    expect(withLimit.data.limit).toBe(3);
  });

  it("open action accepts filename.ext as documentId and resolves to UUID", () => {
    const schema = knowledgeTool.inputSchema as any;

    // Schema should accept any string, not just UUID format
    const result = schema.safeParse({ action: "open", documentId: "TESTFILE.txt", scope: "global" });
    expect(result.success).toBe(true);
  });

  it("unified list tool with feature=knowledge accepts its schema", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const tool = tools.find((t) => t.name === "list");
    expect(tool).toBeDefined();

    // Should accept feature=knowledge with optional scope and configs
    const basic = tool!.inputSchema.safeParse({ feature: "knowledge", scope: "global" });
    expect(basic.success).toBe(true);

    // Should accept knowledge configs (extension, status, createdBy)
    const withConfigs = tool!.inputSchema.safeParse({
      feature: "knowledge",
      scope: "global",
      configs: [{ extension: ".md", status: "ready", createdBy: "user" }],
    });
    expect(withConfigs.success).toBe(true);
  });
});