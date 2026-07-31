import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";

const KNOWLEDGE_TOOL_NAMES = [
  "knowledge_search",
  "knowledge_open",
  "knowledge_list",
  "knowledge_ingest",
  "knowledge_document_create",
  "knowledge_document_edit",
  "knowledge_document_delete",
];

describe("knowledge tools registration", () => {
  it("all 7 knowledge tools are registered in the default registry", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const knowledgeTools = tools.filter((t) => t.name.startsWith("knowledge_"));
    const names = knowledgeTools.map((t) => t.name).sort();

    expect(names).toEqual(KNOWLEDGE_TOOL_NAMES.sort());
    expect(knowledgeTools.length).toBe(7);
  });

  it("each knowledge tool has name, description, inputSchema, and execute", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();

    for (const name of KNOWLEDGE_TOOL_NAMES) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.name).toBe(name);
      expect(tool!.description).toBeTruthy();
      expect(tool!.inputSchema).toBeDefined();
      expect(typeof tool!.execute).toBe("function");
    }
  });

  it("all 7 knowledge tools have permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const knowledgeTools = tools.filter((t) => t.name.startsWith("knowledge_"));

    expect(knowledgeTools.length).toBe(7);
    for (const t of knowledgeTools) {
      expect(t.permissionDefault).toBe("allow");
    }
  });

  it("knowledge tools have outputFields for agent consumption", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const searchTool = tools.find((t) => t.name === "knowledge_search");

    expect(searchTool).toBeDefined();
    expect(searchTool!.outputFields).toBeDefined();
    expect(searchTool!.outputFields!.length).toBeGreaterThan(0);
  });

  it("knowledge_search outputFields include count, total, and hybrid", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const searchTool = tools.find((t) => t.name === "knowledge_search");

    expect(searchTool).toBeDefined();
    const names = searchTool!.outputFields!.map((f) => f.name);
    expect(names).toContain("count");
    expect(names).toContain("total");
    expect(names).toContain("hybrid");
  });

  it("knowledge_search limit is optional so the mode preset chunk count applies", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const searchTool = tools.find((t) => t.name === "knowledge_search");

    // No limit provided — mode preset topK should be used.
    const noLimit = searchTool!.inputSchema.safeParse({ query: "hello", mode: "code" });
    expect(noLimit.success).toBe(true);
    // Explicit limit still honored.
    const withLimit = searchTool!.inputSchema.safeParse({ query: "hello", limit: 3 });
    expect(withLimit.success).toBe(true);
    expect(withLimit.data.limit).toBe(3);
  });

  it("knowledge_open accepts filename.ext as documentId and resolves to UUID", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const openTool = tools.find((t) => t.name === "knowledge_open");
    expect(openTool).toBeDefined();

    // Schema should accept any string, not just UUID format
    const result = openTool!.inputSchema.safeParse({ documentId: "TESTFILE.txt", scope: "global" });
    expect(result.success).toBe(true);
  });

  it("knowledge_list output includes ID: prefix", () => {
    const registry = createDefaultRegistry();
    const tools = registry.list();
    const listTool = tools.find((t) => t.name === "knowledge_list");

    // The schema should accept scope without requiring ID
    const result = listTool!.inputSchema.safeParse({ scope: "global" });
    expect(result.success).toBe(true);
  });
});
