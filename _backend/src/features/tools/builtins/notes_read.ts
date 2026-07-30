import { z } from "zod";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { resolveNotesDir } from "../../../rest/notes";

export const notesReadTool: ToolDef = {
  name: "notes_read",
  description: "A single user note's title, body, and metadata by name within a scope.",
  permissionDefault: "allow",
  outputFields: [
    { name: "found", type: "boolean", description: "Whether the note was found", required: true },
    { name: "name", type: "string", description: "Note name", required: false },
    { name: "title", type: "string", description: "Note title", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Note name (directory slug, unique within scope)"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const notesDir = resolveNotesDir(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (!notesDir) {
      return { title: "Error", output: `Cannot resolve notes directory for scope "${scope}".`, metadata: { found: false }, isError: true };
    }
    const fp = join(notesDir, args.name, "note.json");
    if (!existsSync(fp)) {
      return { title: "Not found", output: `Note "${args.name}" not found in "${scope}" scope.`, metadata: { found: false } };
    }
    const raw = await readFile(fp, "utf-8");
    const data = JSON.parse(raw);
    return {
      title: data.title || args.name,
      output: raw,
      metadata: { found: true, name: args.name, title: data.title || args.name },
    };
  },
};
