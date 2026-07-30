import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeOpenTool: ToolDef = {
  name: "knowledge_open",
  description:
    "Open a full document from the Knowledge Base by its document ID. Returns the complete file content " +
    "for reading as context. Use after knowledge_search to get full document context.",
  permissionDefault: "allow",
  outputFields: [
    { name: "filename", type: "string", description: "Source filename", required: true },
  ],
  inputSchema: z.object({
    documentId: z.string().describe("UUID of the document to open"),
    scope: z.enum(["global", "project", "session"]).default("session").describe("Scope of the document"),
    maxChars: z.number().int().min(100).max(50000).default(10000).optional().describe("Max chars to return"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const doc = await kb.openDocument(
      (args.scope as "global" | "project" | "session") || "session",
      args.documentId,
      args.maxChars,
    );

    if (!doc) {
      return { title: "Document not found", output: `No document with ID: ${args.documentId}` };
    }

    return {
      title: doc.filename,
      output: doc.content,
      metadata: { filename: doc.filename },
    };
  },
};
