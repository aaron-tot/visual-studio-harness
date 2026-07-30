import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

/**
 * Search the Knowledge Base for relevant documents using hybrid retrieval.
 */
export const knowledgeSearchTool: ToolDef = {
  name: "knowledge_search",
  description:
    "Search the Knowledge Base for relevant documents using hybrid semantic + keyword retrieval. " +
    "Returns ranked chunks with source document, section path, content excerpt, and relevance score. " +
    "Use when you need additional context not found in the workspace code or agent skills.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of results returned", required: true },
    { name: "hybrid", type: "boolean", description: "Whether both vector and keyword search were used", required: true },
  ],
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query (natural language or exact term)"),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum results to return"),
    scope: z.enum(["global", "project", "session"]).default("global").describe("Scope to search in"),
    mode: z
      .enum(["general", "code", "research", "documentation"])
      .default("general")
      .describe("Retrieval mode — adjusts chunk count, ranking weights, and metadata priority"),
    filters: z
      .object({
        extension: z.string().optional().describe("Filter by extension (e.g. .md)"),
        createdBy: z.string().optional().describe("Filter by creator: user, agent, system"),
      })
      .optional()
      .describe("Metadata filters"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const { results, hybrid } = await kb.search(
      (args.scope as "global" | "project" | "session") || "global",
      args.query,
      { limit: args.limit, mode: args.mode, filters: args.filters },
      ctx.workspaceRoot,
      ctx.sessionId,
    );

    if (results.length === 0) {
      return {
        title: "No knowledge found",
        output: `No results for query: "${args.query}"`,
        metadata: { count: 0, hybrid },
      };
    }

    const lines = results.map(
      (r: any) =>
        `  [${r.score.toFixed(2)}] ${r.filename} → ${r.section}\n` +
        `       ${r.content.slice(0, 200)}...`,
    );

    return {
      title: `${results.length} knowledge result(s) for "${args.query}"`,
      output: lines.join("\n\n"),
      metadata: { count: results.length, hybrid },
    };
  },
};
