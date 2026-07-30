import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeDocumentDeleteTool: ToolDef = {
  name: "knowledge_document_delete",
  description:
    "Delete a knowledge document and all its associated chunks, embeddings, and search index entries. " +
    "Agent-created documents can be deleted freely. System documents cannot be deleted. " +
    "User-created documents require explicit confirmation.",
  permissionDefault: "allow",
  inputSchema: z.object({
    documentId: z.string().describe("UUID of the document to delete"),
    scope: z.enum(["global", "project", "session"]).default("session").describe("Scope of the document"),
    confirmed: z.boolean().default(false).describe("Must be true for user-created documents"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const result = await kb.deleteDocument(
      (args.scope as "global" | "project" | "session") || "session",
      args.documentId,
      args.confirmed,
    );
    if (!result.ok) {
      return {
        title: "Delete failed",
        output: result.error || "Unknown error",
        isError: true,
      };
    }
    return {
      title: "Document deleted",
      output: `Document ${args.documentId} deleted successfully.`,
    };
  },
};
