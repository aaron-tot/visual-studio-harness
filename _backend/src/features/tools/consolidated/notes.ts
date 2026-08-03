import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { notesCreateTool } from "../builtins/notes_create";
import { notesReadTool } from "../builtins/notes_read";
import { notesUpdateTool } from "../builtins/notes_update";
import { notesArchiveTool } from "../builtins/notes_archive";

/**
 * Consolidated `notes` tool.
 *
 * Replaces the 4 individual notes_* tools with a single tool that dispatches
 * on a required `action` enum. Every original tool name maps to a sub-command
 * with identical behavior — the execute handler forwards to the original
 * tool implementation, so no logic, error handling, or side effects change.
 *
 * Sub-commands:
 *   - read   -> notes_read
 *   - create -> notes_create
 *   - update -> notes_update
 *   - archive -> notes_archive
 *
 * Schema is a flat merged object: `action` is the only required field; all
 * params across the 4 original tools are merged as optional (first-wins on
 * collisions widened to unions where the types differ) to minimize JSON
 * schema overhead.
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

/** Combine a set of zod types into one permissive type (union if multiple distinct). */
function combineTypes(types: z.ZodTypeAny[]): z.ZodTypeAny {
  const unique = Array.from(new Set(types));
  if (unique.length === 1) return unique[0];
  return z.union(unique as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/** Build a flat merged schema: every field from every original tool, all optional. */
function buildMergedSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny[]> = {};
  for (const tool of Object.values(ORIGINAL_TOOLS)) {
    const obj = tool.inputSchema as z.ZodObject<any>;
    const objShape = obj.shape ?? {};
    for (const [key, field] of Object.entries(objShape)) {
      (shape[key] ??= []).push(field as z.ZodTypeAny);
    }
  }
  const merged: Record<string, z.ZodTypeAny> = {};
  for (const [key, typeDefs] of Object.entries(shape)) {
    merged[key] = combineTypes(typeDefs).optional();
  }
  return z.object({
    action: z.enum(NOTES_ACTIONS),
    ...merged,
  });
}

const notesSchema = buildMergedSchema();

export const notesTool: ToolDef = {
  name: "notes",
  description:
    "Consolidated user notes tool. Create, read, update, and archive personal notes. " +
    "Set the required 'action' to select the operation:\n" +
    "  read    - Read a note's title, body, and metadata by name within a scope (notes_read)\n" +
    "  create  - Create a user note with a name, title, and body in a scope (notes_create)\n" +
    "  update  - Update an existing user note's title and/or body by name within a scope (notes_update)\n" +
    "  archive - Archive a user note by renaming its directory with a timestamp suffix (notes_archive)",
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