import { z } from "zod";
import type { ToolDef } from "../types";
import { archiveNote } from "../../../rest/notes";

export const notesArchiveTool: ToolDef = {
  name: "notes_archive",
  description: "Archive a user note by renaming its directory with a .archived.{timestamp} suffix. The user note is hidden from the active list but remains on disk.",
  permissionDefault: "allow",
  outputFields: [
    { name: "archived", type: "boolean", description: "Whether the archive succeeded", required: true },
    { name: "archivedPath", type: "string", description: "New filesystem path of the archived note", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Note name (directory slug)"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const result = await archiveNote({
      name: args.name,
      dataDir: ctx.dataDir,
      scope,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    return {
      title: "Note archived",
      output: `Archived note "${args.name}" in ${scope} scope → ${result.archivedPath}`,
      metadata: { archived: true, archivedPath: result.archivedPath },
    };
  },
};
