import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { notesCreateTool } from "../builtins/notes_create";
import { notesReadTool } from "../builtins/notes_read";
import { notesUpdateTool } from "../builtins/notes_update";
import { notesArchiveTool } from "../builtins/notes_archive";
import { notesMoveTool } from "../builtins/notes_move";

/**
 * Consolidated `notes` tool.
 *
 * Replaces the 4 individual notes_* tools with a single registered tool that
 * dispatches on a required `action` enum. Every sub-command forwards to the
 * original tool implementation, so behavior is identical to before.
 *
 * Sub-commands (via `action`):
 *   read    - Read a note's title, body, and metadata by name   (notes_read)
 *   create  - Create a user note with name, title, and body     (notes_create)
 *   update  - Update a user note's title and/or body by name    (notes_update)
 *   archive - Archive a note by renaming its directory          (notes_archive)
 *
 * Schema is a flat object: `action` is the only required field; all other
 * params are optional and shared across the sub-commands, each defined once.
 */
const NOTES_ACTIONS = [
  "read",
  "create",
  "update",
  "archive",
  "move",
] as const;

export type NotesAction = (typeof NOTES_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<NotesAction, ToolDef> = {
  read: notesReadTool,
  create: notesCreateTool,
  update: notesUpdateTool,
  archive: notesArchiveTool,
  move: notesMoveTool,
};

const notesSchema = z.object({
  action: z.enum(NOTES_ACTIONS).describe("Operation: read, create, update, archive, move"),
  name: z.string().optional().describe("Note name"),
  title: z.string().optional().describe("Title"),
  body: z.string().optional().describe("Body"),
  scope: z.enum(["global", "project", "session"]).optional().describe("Scope"),
  fromScope: z.enum(["global", "project", "session"]).optional().describe("Source scope (move)"),
  toScope: z.enum(["global", "project", "session"]).optional().describe("Target scope (move)"),
});

const notesMoveChecked = notesSchema.superRefine((val, ctx) => {
  if (val.action !== "move") return;
  if (!val.toScope) ctx.addIssue({ code: "custom", message: "toScope is required for move", path: ["toScope"] });
  if (!val.fromScope) ctx.addIssue({ code: "custom", message: "fromScope is required for move", path: ["fromScope"] });
  if (val.fromScope && val.fromScope === val.toScope) {
    ctx.addIssue({ code: "custom", message: "fromScope and toScope must differ", path: ["toScope"] });
  }
});
// This zod build returns a ZodEffects wrapper that drops `.shape`; restore the
// plain object's shape so introspection (tests + field extraction) keeps working.
(notesMoveChecked as any).shape = notesSchema.shape;

export const notesTool: ToolDef = {
  name: "notes",
  description: "Create, read, update, and archive user notes. Set 'action' to pick the operation.",
  permissionDefault: "allow",
  inputSchema: notesMoveChecked,
  execute: async (args, ctx) => {
    const action = args.action as NotesAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown notes action: "${String(args.action)}".`,
        metadata: { found: false },
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const notesActions = NOTES_ACTIONS;
