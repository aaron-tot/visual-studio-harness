import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { auditCreateTool } from "../builtins/audit_create";
import { auditReadTool } from "../builtins/audit_read";
import { auditEditTool } from "../builtins/audit_edit";
import { auditDeleteTool } from "../builtins/audit_delete";
import { auditPromptCreateTool } from "../builtins/audit_prompt_create";
import { auditPromptListTool } from "../builtins/audit_prompt_list";
import { auditPromptReadTool } from "../builtins/audit_prompt_read";
import { auditPromptEditTool } from "../builtins/audit_prompt_edit";
import { auditPromptDeleteTool } from "../builtins/audit_prompt_delete";

/**
 * Consolidated `audit` tool.
 *
 * Replaces the 9 individual audit_* tools with a single tool that dispatches
 * on a required `action` enum. Every original tool name maps to a sub-command
 * with identical behavior — the execute handler forwards to the original
 * tool implementation, so no logic, error handling, or side effects change.
 *
 * Sub-commands:
 *   - create       -> audit_create
 *   - read         -> audit_read
 *   - edit         -> audit_edit
 *   - delete       -> audit_delete
 *   - prompt_create -> audit_prompt_create
 *   - prompt_list  -> audit_prompt_list
 *   - prompt_read  -> audit_prompt_read
 *   - prompt_edit  -> audit_prompt_edit
 *   - prompt_delete -> audit_prompt_delete
 *
 * Schema is a flat merged object: `action` is the only required field; all
 * params across the 9 original tools are merged as optional (first-wins on
 * collisions widened to unions where the types differ) to minimize JSON
 * schema overhead.
 */
const AUDIT_ACTIONS = [
  "create",
  "read",
  "edit",
  "delete",
  "prompt_create",
  "prompt_list",
  "prompt_read",
  "prompt_edit",
  "prompt_delete",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<AuditAction, ToolDef> = {
  create: auditCreateTool,
  read: auditReadTool,
  edit: auditEditTool,
  delete: auditDeleteTool,
  prompt_create: auditPromptCreateTool,
  prompt_list: auditPromptListTool,
  prompt_read: auditPromptReadTool,
  prompt_edit: auditPromptEditTool,
  prompt_delete: auditPromptDeleteTool,
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
    action: z.enum(AUDIT_ACTIONS),
    ...merged,
  });
}

const auditSchema = buildMergedSchema();

export const auditTool: ToolDef = {
  name: "audit",
  description:
    "Consolidated audit tool. Create, read, edit, delete structured audit documents and " +
    "manage reusable audit prompt presets. Set the required 'action' to select the operation:\n" +
    "  create       - Create a structured audit document with findings (audit_create)\n" +
    "  read         - Read a full audit document JSON by name within a scope (audit_read)\n" +
    "  edit         - Edit (overwrite) an existing audit document on disk (audit_edit)\n" +
    "  delete       - Delete an audit document by name within a scope (audit_delete)\n" +
    "  prompt_create - Create a reusable audit prompt preset (audit_prompt_create)\n" +
    "  prompt_list  - List all audit prompt presets (audit_prompt_list)\n" +
    "  prompt_read  - Read a specific audit prompt preset by id (audit_prompt_read)\n" +
    "  prompt_edit  - Edit an existing audit prompt preset (audit_prompt_edit)\n" +
    "  prompt_delete - Delete an audit prompt preset by id (audit_prompt_delete)",
  permissionDefault: "allow",
  inputSchema: auditSchema,
  execute: async (args, ctx) => {
    const action = args.action as AuditAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown audit action: "${String(args.action)}".`,
        metadata: { found: false },
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const auditActions = AUDIT_ACTIONS;
