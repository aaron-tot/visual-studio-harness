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
 * Replaces the 9 individual audit_* tools with a single registered tool that
 * dispatches on a required `action` enum. Every sub-command forwards to the
 * original tool implementation, so behavior is identical to before.
 *
 * Sub-commands (via `action`):
 *   create        - Create a structured audit document with findings   (audit_create)
 *   read          - Read a full audit document JSON by name            (audit_read)
 *   edit          - Overwrite an existing audit document on disk       (audit_edit)
 *   delete        - Delete an audit document by name                   (audit_delete)
 *   prompt_create - Create a reusable audit prompt preset              (audit_prompt_create)
 *   prompt_list   - List all audit prompt presets                      (audit_prompt_list)
 *   prompt_read   - Read a specific audit prompt preset by id          (audit_prompt_read)
 *   prompt_edit   - Edit an existing audit prompt preset               (audit_prompt_edit)
 *   prompt_delete - Delete an audit prompt preset by id                (audit_prompt_delete)
 *
 * Schema is a flat object: `action` is the only required field; all other
 * params are optional and shared across the sub-commands, each defined once.
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

const scopeSchema = z.enum(["global", "project", "session"]).describe("Scope (default: global)");

const auditSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).describe("Operation: create, read, edit, delete, prompt_*"),
  name: z.string().optional().describe("Audit or prompt name (slug)"),
  id: z.string().optional().describe("Prompt id (slug)"),
  scope: scopeSchema.optional(),
  title: z.string().optional().describe("Title"),
  auditType: z.string().optional().describe("Audit category (e.g. implementation_completed, custom)"),
  endGoal: z.string().optional().describe("Question the audit answers"),
  summary: z.string().optional().describe("Executive summary"),
  findings: z.array(z.record(z.unknown())).optional().describe("Audit findings; see skill:audit"),
  attachments: z.array(z.record(z.unknown())).optional().describe("Linked designs/specs/plans; see skill:audit"),
  overallStatus: z.enum(["pass", "partial", "fail"]).optional().describe("Overall status"),
  overallAssessment: z.string().optional().describe("Overall assessment"),
  assessments: z.array(z.record(z.unknown())).optional().describe("Per-aspect assessments; see skill:audit"),
  agentModel: z.string().optional().describe("Model"),
  rawReport: z.string().optional().describe("Full markdown report"),
  document: z
    .object({})
    .passthrough()
    .optional()
    .describe("Full audit document (edit) — see skill:audit"),
  description: z.string().optional().describe("Prompt description"),
  category: z.enum(["general", "implementation"]).optional().describe("Prompt category"),
  templateInstructions: z.string().optional().describe("Prompt instructions"),
});

export const auditTool: ToolDef = {
  name: "audit",
  description:
    "Create/read/edit/delete audit documents and manage audit prompt presets. " +
    "Read skill:audit before performing an audit — it defines the findings/assessments/attachments structure. " +
    "Set 'action' to pick the operation.",
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
