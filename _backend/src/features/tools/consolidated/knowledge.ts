import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { knowledgeSearchTool } from "../builtins/knowledge_search";
import { knowledgeOpenTool } from "../builtins/knowledge_open";
import { knowledgeIngestTool } from "../builtins/knowledge_ingest";
import { knowledgeDocumentCreateTool } from "../builtins/knowledge_document_create";
import { knowledgeDocumentEditTool } from "../builtins/knowledge_document_edit";
import { knowledgeDocumentDeleteTool } from "../builtins/knowledge_document_delete";

/**
 * Consolidated `knowledge` tool.
 *
 * Replaces the 6 individual knowledge_* tools with a single tool that dispatches
 * on a required `action` enum. Every original tool name maps to a sub-command
 * with identical behavior — the execute handler forwards to the original
 * tool implementation, so no logic, error handling, or side effects change.
 *
 * Sub-commands:
 *   - search       -> knowledge_search
 *   - open         -> knowledge_open
 *   - ingest       -> knowledge_ingest
 *   - doc_create   -> knowledge_document_create
 *   - doc_edit     -> knowledge_document_edit
 *   - doc_delete   -> knowledge_document_delete
 *
 * Schema is a flat merged object: `action` is the only required field; all
 * params across the 6 original tools are merged as optional (first-wins on
 * collisions widened to unions where the types differ) to minimize JSON
 * schema overhead.
 */
const KNOWLEDGE_ACTIONS = [
  "search",
  "open",
  "ingest",
  "doc_create",
  "doc_edit",
  "doc_delete",
] as const;

export type KnowledgeAction = (typeof KNOWLEDGE_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<KnowledgeAction, ToolDef> = {
  search: knowledgeSearchTool,
  open: knowledgeOpenTool,
  ingest: knowledgeIngestTool,
  doc_create: knowledgeDocumentCreateTool,
  doc_edit: knowledgeDocumentEditTool,
  doc_delete: knowledgeDocumentDeleteTool,
};

/** Combine a set of zod types into one permissive type (union if multiple distinct). */
function combineTypes(types: z.ZodTypeAny[]): z.ZodTypeAny {
  const unique = Array.from(new Set(types));
  if (unique.length === 1) return unique[0];
  return z.union(unique as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/** Build a flat merged schema: every field from every original tool, all optional. */
function buildMergedSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny[]> = {};
  for (const tool of Object.values(ORIGINAL_TOOLS)) {
    const obj = tool.inputSchema as z.ZodObject<any>;
    const objShape = obj.shape ?? {};
    for (const [key, field] of Object.entries(objShape)) {
      (shape[key] ??= []).push(field as z.ZodTypeAny);
    }
  }
  const merged: Record<string, z.ZodTypeAny> = {};
  for (const [key, typeDefs] of Object.entries(shape)) {
    merged[key] = combineTypes(typeDefs).optional();
  }
  return z.object({
    action: z.enum(KNOWLEDGE_ACTIONS),
    ...merged,
  });
}

const knowledgeSchema = buildMergedSchema();

export const knowledgeTool: ToolDef = {
  name: "knowledge",
  description:
    "Consolidated Knowledge Base tool. Search, open, ingest, and manage documents. " +
    "Set the required 'action' to select the operation:\n" +
    "  search       - Search the Knowledge Base for relevant documents (knowledge_search)\n" +
    "  open         - Open a full document by UUID or filename (knowledge_open)\n" +
    "  ingest       - Trigger re-ingestion of knowledge sources (knowledge_ingest)\n" +
    "  doc_create   - Create a new knowledge document (knowledge_document_create)\n" +
    "  doc_edit     - Edit an existing knowledge document (knowledge_document_edit)\n" +
    "  doc_delete   - Delete a knowledge document (knowledge_document_delete)",
  permissionDefault: "allow",
  outputFields: [
    { name: "action", type: "string", description: "Knowledge sub-action performed", required: false },
    { name: "count", type: "integer", description: "Number of results returned (search)", required: false },
    { name: "total", type: "integer", description: "Total matching results before top-K truncation (search)", required: false },
    { name: "hybrid", type: "boolean", description: "Whether both vector and keyword search were used (search)", required: false },
    { name: "filename", type: "string", description: "Source filename (open)", required: false },
    { name: "added", type: "integer", description: "Documents added (ingest)", required: false },
    { name: "updated", type: "integer", description: "Documents updated (ingest)", required: false },
    { name: "deleted", type: "integer", description: "Documents deleted (ingest)", required: false },
    { name: "id", type: "string", description: "Document UUID (doc_create, doc_edit, doc_delete)", required: false },
  ],
  inputSchema: knowledgeSchema,
  execute: async (args, ctx) => {
    const action = args.action as KnowledgeAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown knowledge action: "${String(args.action)}".`,
        metadata: { found: false },
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const knowledgeActions = KNOWLEDGE_ACTIONS;