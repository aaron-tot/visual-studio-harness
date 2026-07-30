import { z } from "zod";
import type { ToolDef } from "../types";
import { AUDIT_CATEGORIES } from "../../../../../_shared/types/audit";
import { createAudit } from "../../../rest/audits";
import { localISOString } from "../../../utils/datetime";

export const auditCreateTool: ToolDef = {
  name: "audit_create",
  description:
    "Create a structured audit document with findings. Audits are standardized analysis reports " +
    "created by the agent. Two families: implementation_completed (cross-refs code vs spec/plan) " +
    "and general_audit (free-form named audit with endGoal). Returns the file path and name.",
  permissionDefault: "allow",
  outputFields: [
    { name: "created", type: "boolean", description: "Whether the audit was created", required: true },
    { name: "name", type: "string", description: "Audit directory name", required: false },
    { name: "path", type: "string", description: "Filesystem path to the audit directory", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Unique slug name for the audit directory (e.g. 'memleak-audit-main')"),
    title: z.string().min(1).describe("Human-readable title (e.g. 'Memory Leak Audit: Main Codebase')"),
    auditType: z
      .enum(AUDIT_CATEGORIES)
      .describe(
        "Audit category. 'implementation_completed' compares code vs spec/plan. " +
          "'general_audit' is a free-form named audit with endGoal. Use specific categories for targeted sweeps."
      ),
    endGoal: z.string().optional().describe("Mission statement for the audit. Required for general_audit. Describes what was being examined."),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
    summary: z.string().min(1).describe("Executive summary of audit findings"),
    findings: z
      .array(
        z.object({
          severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("Severity level of the finding"),
          file: z.string().optional().describe("Relative file path in the workspace"),
          line: z.number().int().positive().optional().describe("Line number in the file"),
          title: z.string().min(1).describe("Short one-liner for the finding"),
          description: z.string().min(1).describe("Detailed explanation of the issue"),
          recommendation: z.string().min(1).describe("Suggested fix or mitigation"),
          category: z.string().min(1).describe("Type of issue (e.g. 'missing_implementation', 'memory_leak', 'hardcoded_secret')"),
          effort: z.enum(["quick", "moderate", "significant"]).optional().describe("Estimated effort to fix"),
        })
      )
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
    overallStatus: z.enum(["pass", "partial", "fail"]).optional().describe("Overall implementation status (implementation_completed only)"),
    overallAssessment: z.string().optional().describe("Human-readable overall assessment (implementation_completed only)"),
    assessments: z
      .array(
        z.object({
          aspectName: z.string().min(1).describe("Name of the aspect being assessed"),
          expectedBehavior: z.string().optional().describe("What was expected per the spec/plan"),
          status: z.enum(["implemented_as_expected", "implemented_differently", "not_implemented"]).describe("Implementation status"),
          actualImplementation: z.string().optional().describe("What was actually implemented, if different"),
          fileReferences: z.array(z.string()).optional().describe("Relevant file paths"),
        })
      )
      .optional()
      .describe("Per-aspect assessments (implementation_completed only)"),
    agentModel: z.string().optional().describe("The model that performed the audit"),
    rawReport: z.string().optional().describe("Optional full markdown report for back-reference"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of args.findings) {
      severityCounts[f.severity]++;
    }

    const document = {
      meta: {
        id: args.name,
        title: args.title,
        auditType: args.auditType,
        endGoal: args.endGoal,
        createdAt: localISOString(),
        createdBy: "agent" as const,
        agentModel: args.agentModel || [ctx.providerName, ctx.modelName].filter(Boolean).join(" / ") || undefined,
        scope,
        workspaceRoot: ctx.workspaceRoot || undefined,
        sessionId: ctx.sessionId || undefined,
        summary: args.summary,
        totalFindings: args.findings.length,
        criticalCount: severityCounts.critical,
        highCount: severityCounts.high,
        mediumCount: severityCounts.medium,
        lowCount: severityCounts.low,
        infoCount: severityCounts.info,
        attachments: args.attachments?.length ? args.attachments : undefined,
        overallStatus: args.overallStatus,
        overallAssessment: args.overallAssessment,
        assessments: args.assessments?.length ? args.assessments : undefined,
      },
      findings: args.findings,
      rawReport: args.rawReport,
    };

    try {
      const result = await createAudit({
        name: args.name,
        document,
        dataDir: ctx.dataDir,
        scope,
        workspaceRoot: ctx.workspaceRoot,
        sessionId: ctx.sessionId,
      });

      return {
        title: "Audit created",
        output: `Created audit "${args.title}" as "${args.name}" in ${scope} scope. ${args.findings.length} findings (${severityCounts.critical} critical, ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low, ${severityCounts.info} info).`,
        metadata: { created: true, name: args.name, path: result.path },
      };
    } catch (err) {
      return {
        title: "Failed to create audit",
        output: `Error creating audit "${args.name}": ${(err as Error).message}`,
        metadata: { created: false },
        isError: true,
      };
    }
  },
};
