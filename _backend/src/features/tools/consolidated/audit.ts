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
const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]).describe("Severity level of the finding");
const statusSchema = z.enum(["implemented_as_expected", "implemented_differently", "not_implemented"]).describe("Implementation status");

const auditSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).describe("Audit operation to perform"),
  name: z
    .string()
    .optional()
    .describe("Audit or prompt name (slug / directory name, e.g. 'memleak-audit-main')"),
  id: z.string().optional().describe("Prompt id (slug) — used by prompt_read/prompt_edit/prompt_delete"),
  scope: scopeSchema.optional(),
  title: z.string().optional().describe("Human-readable title"),
  auditType: z
    .string()
    .optional()
    .describe("Audit category (e.g. 'implementation_completed', 'general_audit', 'custom')"),
  endGoal: z.string().optional().describe("Mission statement / question the audit answers"),
  summary: z.string().optional().describe("Executive summary of audit findings"),
  findings: z
    .array(
      z.object({
        severity: severitySchema,
        file: z.string().optional().describe("Relative file path in the workspace"),
        line: z.number().int().positive().optional().describe("Line number in the file"),
        title: z.string().describe("Short one-liner for the finding"),
        description: z.string().describe("Detailed explanation of the issue"),
        recommendation: z.string().describe("Suggested fix or mitigation"),
        category: z.string().describe("Type of issue (e.g. 'memory_leak', 'hardcoded_secret')"),
        effort: z
          .enum(["quick", "moderate", "significant"])
          .optional()
          .describe("Estimated effort to fix"),
      })
    )
    .optional()
    .describe("List of individual findings in the audit"),
  attachments: z
    .array(
      z.object({
        designName: z.string().optional().describe("Name of the attached design directory"),
        specName: z.string().optional().describe("Spec version name (e.g. 'specV2')"),
        planName: z.string().optional().describe("Plan version name (e.g. 'planV1')"),
        label: z.string().optional().describe("Human-readable label for this attachment"),
      })
    )
    .optional()
    .describe("Links to associated designs, specs, and/or plans"),
  overallStatus: z
    .enum(["pass", "partial", "fail"])
    .optional()
    .describe("Overall implementation status (implementation_completed only)"),
  overallAssessment: z.string().optional().describe("Human-readable overall assessment (implementation_completed only)"),
  assessments: z
    .array(
      z.object({
        aspectName: z.string().describe("Name of the aspect being assessed"),
        expectedBehavior: z.string().optional().describe("What was expected per the spec/plan"),
        status: statusSchema,
        actualImplementation: z.string().optional().describe("What was actually implemented, if different"),
        fileReferences: z.array(z.string()).optional().describe("Relevant file paths"),
      })
    )
    .optional()
    .describe("Per-aspect assessments (implementation_completed only)"),
  agentModel: z.string().optional().describe("The model that performed the audit"),
  rawReport: z.string().optional().describe("Optional full markdown report for back-reference"),
  document: z
    .object({})
    .passthrough()
    .optional()
    .describe("Full updated audit document (for edit) — see the original audit structure"),
  description: z.string().optional().describe("Short description of what the prompt checks"),
  category: z
    .enum(["general", "implementation"])
    .optional()
    .describe("Prompt category (default: general)"),
  templateInstructions: z
    .string()
    .optional()
    .describe("Instructions the agent follows when running this audit prompt"),
});

export const auditTool: ToolDef = {
  name: "audit",
  description:
    "Consolidated audit tool. Create/read/edit/delete structured audit documents and manage reusable audit prompt presets. " +
    "Set the required 'action' to choose the operation (create, read, edit, delete, prompt_create, prompt_list, prompt_read, prompt_edit, prompt_delete).",
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
