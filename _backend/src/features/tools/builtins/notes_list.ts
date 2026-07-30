import { z } from "zod";
import type { ToolDef } from "../types";
import { listNotes } from "../../../rest/notes";

export const notesListTool: ToolDef = {
  name: "notes_list",
  description: "Notes in a scope (global, project, or session). Each user note has a name, title, body, and metadata.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of notes found", required: true },
    { name: "scope", type: "string", description: "Scope that was queried", required: true },
  ],
  inputSchema: z.object({
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const entries = await listNotes(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (entries.length === 0) {
      return { title: "No notes", output: `No notes found in "${scope}" scope.`, metadata: { count: 0, scope } };
    }
    const lines = entries.map((e) => `  ${e.name}  — ${e.title}`);
    return {
      title: `${entries.length} note(s) in ${scope} scope`,
      output: lines.join("\n"),
      metadata: { count: entries.length, scope },
    };
  },
};
