import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeDocumentMoveTool: ToolDef = {
  name: "knowledge_document_move",
  description:
    "Move a knowledge document to another scope (global/project/session), preserving its id, chunks, embeddings, versions, relationships, and source file.",
  permissionDefault: "allow",
  inputSchema: z.object({
    documentId: z.string().optional().describe("UUID of the document to move"),
    filename: z.string().optional().describe("Filename used to resolve the document when documentId is omitted"),
    fromScope: z.enum(["global", "project", "session"]).optional().describe("Source scope (default: resolve by filename across scopes)"),
    toScope: z.enum(["global", "project", "session"]).describe("Target scope"),
  }),
  execute: async (args, ctx) => {
    try {
      const kb = getKbService();
      let docId = args.documentId;
      let fromScope = args.fromScope;
      if (!docId && args.filename) {
        for (const scope of ["session", "project", "global"] as const) {
          const meta = await kb.resolveFilename(scope, args.filename, ctx.workspaceRoot, ctx.sessionId);
          if (meta) {
            docId = meta.id;
            fromScope = scope;
            break;
          }
        }
        if (!docId) {
          return {
            title: "Move failed",
            output: `Document "${args.filename}" not found in any scope`,
            isError: true,
          };
        }
      }
      if (!docId) {
        return {
          title: "Move failed",
          output: "documentId or filename is required",
          isError: true,
        };
      }
      const r = await kb.moveDocument(
        (fromScope as "global" | "project" | "session") || "global",
        args.toScope,
        docId,
        ctx.workspaceRoot,
        ctx.sessionId,
      );
      return {
        title: "Document moved",
        output: `Document ${docId} moved from ${fromScope || "global"} to ${args.toScope} scope.`,
        metadata: r,
      };
    } catch (err) {
      return {
        title: "Move failed",
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  },
};
