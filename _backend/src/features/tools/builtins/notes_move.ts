import { z } from "zod";
import type { ToolDef } from "../types";
import { moveNote, findNoteScope } from "../../../rest/notes";

export const notesMoveTool: ToolDef = {
  name: "notes_move",
  description:
    "Move a user note to another scope (global/project/session). " +
    "fromScope is optional — when omitted the existing note is resolved (session→project→global).",
  permissionDefault: "allow",
  inputSchema: z.object({
    name: z.string().min(1).describe("Note name"),
    fromScope: z.enum(["global", "project", "session"]).optional().describe("Source scope"),
    toScope: z.enum(["global", "project", "session"]).describe("Target scope"),
  }),
  execute: async (args, ctx) => {
    try {
      const fromScope =
        args.fromScope ??
        (await findNoteScope(args.name, ctx.dataDir, ctx.workspaceRoot, ctx.sessionId));
      if (!fromScope) {
        return {
          title: "Move failed",
          output: `Note "${args.name}" not found in any scope`,
          isError: true,
        };
      }
      const r = await moveNote({
        name: args.name,
        fromScope,
        toScope: args.toScope,
        dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      return {
        title: "Note moved",
        output: `Moved note "${args.name}" from ${fromScope} to ${args.toScope} scope.`,
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
