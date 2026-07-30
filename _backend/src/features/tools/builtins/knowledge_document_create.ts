import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";
import { AGENT_FILENAME_PREFIX } from "../../knowledge-base/constants";

export const knowledgeDocumentCreateTool: ToolDef = {
  name: "knowledge_document_create",
  description:
    "Create a new knowledge document. The document is written to the knowledge sources folder, automatically " +
    "ingested, and assigned a scope. Agent-created documents are prefixed with 'agentCreate_' in the filename.",
  permissionDefault: "allow",
  outputFields: [
    { name: "id", type: "string", description: "Document UUID", required: true },
    { name: "filename", type: "string", description: "Filename on disk", required: true },
  ],
  inputSchema: z.object({
    filename: z.string().min(1).describe("Filename (must end in .md or .txt)"),
    content: z.string().min(1).describe("Document content in markdown or plain text"),
    tags: z.array(z.string()).optional().describe("Optional tags"),
    scope: z.enum(["global", "project", "session"]).default("session").describe("Scope for the document"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const prefixedFilename = `${AGENT_FILENAME_PREFIX}${args.filename}`;
    const doc = await kb.createDocument(
      (args.scope as "global" | "project" | "session") || "session",
      {
        filename: prefixedFilename,
        content: args.content,
        tags: args.tags,
        scope: args.scope || "session",
        createdBy: "agent",
      },
    );
    return {
      title: "Document created",
      output: `Created ${doc.filename} (ID: ${doc.id})`,
      metadata: { id: doc.id, filename: doc.filename, scope: args.scope },
    };
  },
};
