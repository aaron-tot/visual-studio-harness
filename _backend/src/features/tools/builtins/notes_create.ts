import { z } from "zod";
import type { ToolDef } from "../types";
import { createNote } from "../../../rest/notes";

export const notesCreateTool: ToolDef = {
  name: "notes_create",
  description: "Create a user note with a name, title, and body in a scope.",
  permissionDefault: "allow",
  outputFields: [
    { name: "created", type: "boolean", description: "Whether the note was created", required: true },
    { name: "path", type: "string", description: "Filesystem path to the note directory", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Unique name slug for the note directory (e.g. 'my-thoughts')"),
    title: z.string().describe("Human-readable title for the note"),
    body: z.string().describe("Markdown or plain-text body content"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const result = await createNote({
      name: args.name,
      title: args.title,
      body: args.body,
      dataDir: ctx.dataDir,
      scope,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    return {
      title: "Note created",
      output: `Created note "${args.title}" as "${args.name}" in ${scope} scope.`,
      metadata: { created: true, path: result.path },
    };
  },
};
