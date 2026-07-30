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
});
