import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeDocumentEditTool: ToolDef = {
  name: "knowledge_document_edit",
  description:
    "Edit an existing knowledge document by replacing its content. Triggers re-ingestion. " +
    "Agent-created documents can be edited freely.",
  permissionDefault: "allow",
  outputFields: [
    { name: "id", type: "string", description: "Document UUID", required: true },
    { name: "filename", type: "string", description: "Filename", required: true },
  ],
  inputSchema: z.object({
    documentId: z.string().describe("UUID of the document to edit"),
    content: z.string().min(1).describe("New document content"),
    scope: z.enum(["global", "project", "session"]).default("global").describe("Scope of the document"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const doc = await kb.editDocument(
      (args.scope as "global" | "project" | "session") || "global",
      args.documentId,
      args.content,
    );
    return {
      title: "Document updated",
      output: `Updated ${doc.filename}`,
      metadata: { id: doc.id, filename: doc.filename },
    };
  },
};
