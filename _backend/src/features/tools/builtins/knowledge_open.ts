import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";
import { openDocumentByIdOrFilename } from "../../knowledge-base/service-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const knowledgeOpenTool: ToolDef = {
  name: "knowledge_open",
  description:
    "Open a full document from the Knowledge Base by its document ID (UUID) or filename. Returns the complete file " +
    "content for reading as context. Use after knowledge_search or knowledge_list to get full document context. " +
    "Accepts either a UUID or a filename.ext string.",
  permissionDefault: "allow",
  outputFields: [
    { name: "filename", type: "string", description: "Source filename", required: true },
  ],
  inputSchema: z.object({
    documentId: z.string().describe("UUID or filename.ext of the document to open"),
    scope: z.enum(["global", "project", "session"]).default("global").describe("Scope of the document"),
    maxChars: z.number().int().min(100).max(50000).default(10000).optional().describe("Max chars to return"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const scope = (args.scope as "global" | "project" | "session") || "global";

    const doc = await openDocumentByIdOrFilename(
      kb.dataDir,
      scope,
      args.documentId,
      args.maxChars,
      ctx.workspaceRoot,
      ctx.sessionId,
    );

    if (!doc) {
      return { title: "Document not found", output: `No document found: ${args.documentId}` };
    }

    return {
      title: doc.filename,
      output: doc.content,
      metadata: { filename: doc.filename },
    };
  },
};
