import { z } from "zod";
import type { ToolDef } from "../tool-types";
import { editAudit } from "../../../rest/audits";
import { AUDIT_CATEGORIES } from "../../../../../_shared/types/audit";

const AuditCategorySchema = z.enum(
  AUDIT_CATEGORIES as [string, ...string[]]
) as z.ZodEnum<[string, ...string[]]>;

export const auditEditTool: ToolDef = {
  name: "audit_edit",
  description: "Edit (overwrite) an existing audit document on disk",
  permissionDefault: "allowed",

  inputSchema: z.object({
    name: z.string().describe("Audit name (directory name, e.g. 'code-review-42')"),
    document: z.object({
      meta: z.object({
        id: z.string().describe("Unique identifier slug"),
        title: z.string().describe("Human-readable title"),
        auditType: AuditCategorySchema.describe("Audit category"),
        endGoal: z.string().optional().describe("What question this audit answers (general_audit)"),
        createdAt: z.string().describe("ISO 8601 timestamp"),
        createdBy: z.string().describe("Who created this (usually 'agent')"),
        providerName: z.string().optional().describe("Provider name"),
        agentModel: z.string().optional().describe("Model identifier"),
        scope: z.string().describe("Scope level: global, project, or session"),
        workspaceRoot: z.string().optional(),
        sessionId: z.string().optional(),
        summary: z.string().describe("Executive summary"),
        totalFindings: z.number().int().nonnegative(),
        criticalCount: z.number().int().nonnegative(),
        highCount: z.number().int().nonnegative(),
        mediumCount: z.number().int().nonnegative(),
        lowCount: z.number().int().nonnegative(),
        infoCount: z.number().int().nonnegative(),
        attachments: z
          .array(
            z.object({
              designName: z.string().optional(),
              specName: z.string().optional(),
              planName: z.string().optional(),
              label: z.string().optional(),
            })
          )
          .optional()
          .describe("Links to designs/specs/plans (implementation_completed only)"),
        overallStatus: z
          .enum(["pass", "partial", "fail"])
          .optional()
          .describe("Overall verdict (implementation_completed only)"),
        overallAssessment: z.string().optional(),
        assessments: z
          .array(
            z.object({
              aspectName: z.string().describe("Name of the aspect"),
              expectedBehavior: z.string().optional(),
              status: z
                .enum(["implemented_as_expected", "implemented_differently", "not_implemented"])
                .describe("Implementation status"),
              actualImplementation: z.string().optional(),
              fileReferences: z.array(z.string()).optional(),
            })
          )
          .optional()
          .describe("Per-aspect assessments (implementation_completed only)"),
      }),
      findings: z.array(
        z.object({
          severity: z.enum(["critical", "high", "medium", "low", "info"]),
          file: z.string().optional(),
          line: z.number().int().nonnegative().optional(),
          title: z.string(),
          description: z.string(),
          recommendation: z.string(),
          category: z.string().optional(),
          effort: z.enum(["quick", "moderate", "significant"]).optional(),
        })
      ),
      rawReport: z.string().optional().describe("Full markdown dump"),
    }).describe("Full updated audit document"),
    scope: z
      .enum(["global", "project", "session"])
      .optional()
      .default("global")
      .describe("Scope level"),
  }),

  outputSchema: z.object({
    path: z.string(),
    isError: z.boolean().optional(),
    message: z.string().optional(),
  }),

  async execute(args, context) {
    const { name, document, scope } = args;
    const scopeVal = scope || "global";
    try {
      const result = await editAudit({
        name,
        document,
        dataDir: context.dataDir,
        scope: scopeVal as "global" | "project" | "session",
        workspaceRoot: context.workspaceRoot || undefined,
        sessionId: context.sessionId || undefined,
      });
      return { path: result.path };
    } catch (err) {
      return {
        path: "",
        isError: true,
        message: `Failed to edit audit: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
