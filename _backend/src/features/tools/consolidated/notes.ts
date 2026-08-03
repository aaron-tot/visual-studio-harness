import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { notesCreateTool } from "../builtins/notes_create";
import { notesReadTool } from "../builtins/notes_read";
import { notesUpdateTool } from "../builtins/notes_update";
import { notesArchiveTool } from "../builtins/notes_archive";

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
] as const;

export type NotesAction = (typeof NOTES_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<NotesAction, ToolDef> = {
  read: notesReadTool,
  create: notesCreateTool,
  update: notesUpdateTool,
  archive: notesArchiveTool,
};

const notesSchema = z.object({
  action: z.enum(NOTES_ACTIONS).describe("Notes operation to perform"),
  name: z.string().optional().describe("Note name (directory slug, unique within scope)"),
  title: z.string().optional().describe("Human-readable title"),
  body: z.string().optional().describe("Markdown or plain-text body content"),
  scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
});

export const notesTool: ToolDef = {
  name: "notes",
  description:
    "Consolidated user notes tool. Create, read, update, and archive personal notes. " +
    "Set the required 'action' to choose the operation (read, create, update, archive).",
  permissionDefault: "allow",
  inputSchema: notesSchema,
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
