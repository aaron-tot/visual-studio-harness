import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeListTool: ToolDef = {
  name: "knowledge_list",
  description:
    "List all documents in the Knowledge Base with their metadata (filename, extension, size, tags, " +
    "status, created_by, index date). Use this to discover what knowledge sources are available before searching.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of documents", required: true },
  ],
  inputSchema: z.object({
    scope: z.enum(["global", "project", "session"]).default("session").describe("Scope to list from"),
    extension: z.string().optional().describe("Filter by extension"),
    status: z.enum(["pending", "processing", "ready", "failed"]).optional().describe("Filter by indexing status"),
    createdBy: z.string().optional().describe("Filter by creator"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const docs = await kb.listDocuments(
      (args.scope as "global" | "project" | "session") || "session",
      { extension: args.extension, status: args.status, createdBy: args.createdBy },
    );

    if (docs.length === 0) {
      return { title: "No knowledge documents", output: "No documents found.", metadata: { count: 0 } };
    }

    const lines = docs.map((d: any) =>
      `  ${d.filename}  (${d.extension}, ${d.fileSize} bytes, status: ${d.status}` +
      `${d.tags?.length ? `, tags: ${d.tags.join(", ")}` : ""}` +
      `${d.createdBy ? `, by: ${d.createdBy}` : ""})`,
    );

    return {
      title: `${docs.length} knowledge document(s)`,
      output: lines.join("\n"),
      metadata: { count: docs.length },
    };
  },
};
