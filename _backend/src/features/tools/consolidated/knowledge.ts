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
 * Replaces the 6 individual knowledge_* tools with a single registered tool
 * that dispatches on a required `action` enum. Every sub-command forwards to
 * the original tool implementation, so behavior is identical to before.
 *
 * Sub-commands (via `action`):
 *   search     - Search the Knowledge Base for relevant documents (knowledge_search)
 *   open       - Open a full document by UUID or filename          (knowledge_open)
 *   ingest     - Trigger re-ingestion of knowledge sources          (knowledge_ingest)
 *   doc_create - Create a new knowledge document                    (knowledge_document_create)
 *   doc_edit   - Edit an existing knowledge document                (knowledge_document_edit)
 *   doc_delete - Delete a knowledge document                        (knowledge_document_delete)
 *
 * Schema is a flat object: `action` is the only required field; all other
 * params are optional and shared across the sub-commands, each defined once.
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

const knowledgeSchema = z.object({
  action: z.enum(KNOWLEDGE_ACTIONS).describe("Operation"),
  query: z.string().optional().describe("Search query"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results"),
  scope: z.enum(["global", "project", "session"]).optional().describe("Scope"),
  mode: z
    .enum(["general", "code", "research", "documentation"])
    .optional()
    .describe("Retrieval mode"),
  filters: z
    .object({
      extension: z.string().optional().describe("Extension (e.g. .md)"),
      createdBy: z.string().optional().describe("Creator (user/agent/system)"),
    })
    .optional()
    .describe("Metadata filters"),
  documentId: z.string().optional().describe("Document UUID or filename"),
  maxChars: z.number().int().min(100).max(50000).optional().describe("Max chars"),
  filename: z.string().optional().describe("Filename (.md/.txt)"),
  content: z.string().optional().describe("Document content"),
  tags: z.array(z.string()).optional().describe("Tags"),
  confirmed: z.boolean().optional().describe("Confirm delete"),
});

export const knowledgeTool: ToolDef = {
  name: "knowledge",
  description:
    "Search, open, ingest, and manage Knowledge Base documents. " +
    "Set 'action' to pick the operation.",
  permissionDefault: "allow",
  outputFields: [
    { name: "action", type: "string", description: "Knowledge sub-action performed", required: false },
    { name: "count", type: "number", description: "Number of results returned (search)", required: false },
    { name: "total", type: "number", description: "Total matching results before top-K truncation (search)", required: false },
    { name: "hybrid", type: "boolean", description: "Whether both vector and keyword search were used (search)", required: false },
    { name: "filename", type: "string", description: "Source filename (open)", required: false },
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
