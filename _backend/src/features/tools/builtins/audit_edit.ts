import { z } from "zod";
import type { ToolDef } from "../types";
import { editAudit } from "../../../rest/audits";
import { AUDIT_CATEGORIES } from "../../../../../_shared/types/audit";

export const auditEditTool: ToolDef = {
  name: "audit_edit",
  description: "Edit (overwrite) an existing audit document on disk",
  permissionDefault: "allow",

  inputSchema: z.object({
    name: z.string().describe("Audit name (directory name, e.g. 'code-review-42')"),
    document: z.object({
      meta: z.object({
        id: z.string().describe("Unique identifier slug"),
        title: z.string().describe("Human-readable title"),
        auditType: z.enum(AUDIT_CATEGORIES).describe("Audit category"),
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

  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the audit was updated", required: true },
    { name: "name", type: "string", description: "Audit directory name", required: false },
    { name: "path", type: "string", description: "Filesystem path to the audit directory", required: false },
  ],

  async execute(args, ctx) {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    try {
      const result = await editAudit({
        name: args.name,
        document: args.document,
        dataDir: ctx.dataDir,
        scope,
        workspaceRoot: ctx.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      return {
        title: "Audit updated",
        output: `Updated audit "${args.name}" in ${scope} scope.`,
        metadata: { updated: true, name: args.name, path: result.path },
      };
    } catch (err) {
      return {
        title: "Failed to update audit",
        output: `Error updating audit "${args.name}": ${(err as Error).message}`,
        metadata: { updated: false, name: args.name, path: "" },
        isError: true,
      };
    }
  },
};
