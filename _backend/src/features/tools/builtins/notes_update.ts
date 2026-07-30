import { z } from "zod";
import type { ToolDef } from "../types";
import { updateNote } from "../../../rest/notes";

export const notesUpdateTool: ToolDef = {
  name: "notes_update",
  description: "Update an existing user note's title and/or body by name within a scope.",
  permissionDefault: "allow",
  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the update succeeded", required: true },
    { name: "path", type: "string", description: "Filesystem path to the note directory", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Note name (directory slug)"),
    title: z.string().optional().describe("New title (omit to keep current)"),
    body: z.string().optional().describe("New body (omit to keep current)"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const result = await updateNote({
      name: args.name,
      title: args.title,
      body: args.body,
      dataDir: ctx.dataDir,
      scope,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    return {
      title: "Note updated",
      output: `Updated note "${args.name}" in ${scope} scope.`,
      metadata: { updated: true, path: result.path },
    };
  },
};
