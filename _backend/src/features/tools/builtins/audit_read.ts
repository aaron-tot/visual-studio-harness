import { z } from "zod";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { resolveAuditsDir, findAuditScope } from "../../../rest/audits";
import type { AuditScope } from "../../../rest/audits";

export const auditReadTool: ToolDef = {
  name: "audit_read",
  description:
    "Read the full audit document JSON for a specific audit by name within a scope. " +
    "Includes meta, structured findings, assessments (if implementation_completed), and rawReport (if any).",
  permissionDefault: "allow",
  outputFields: [
    { name: "found", type: "boolean", description: "Whether the audit was found", required: true },
    { name: "name", type: "string", description: "Audit name", required: false },
    { name: "title", type: "string", description: "Audit title", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Audit name (directory slug, unique within scope)"),
    scope: z
      .enum(["global", "project", "session"])
      .optional()
      .describe("Scope (omit to search session→project→global)"),
  }),
  execute: async (args, ctx) => {
    let scope = args.scope as AuditScope | undefined;
    if (!scope) {
      scope = (await findAuditScope(args.name, ctx.dataDir, ctx.workspaceRoot, ctx.sessionId)) ?? undefined;
      if (!scope) {
        return {
          title: "Not found",
          output: `Audit "${args.name}" not found in session/project/global scopes.`,
          metadata: { found: false },
        };
      }
    }
    const auditsDir = resolveAuditsDir(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (!auditsDir) {
      return {
        title: "Error",
        output: `Cannot resolve audits directory for scope "${scope}".`,
        metadata: { found: false },
        isError: true,
      };
    }
    const fp = join(auditsDir, args.name, "audit.json");
    if (!existsSync(fp)) {
      return {
        title: "Not found",
        output: `Audit "${args.name}" not found in "${scope}" scope.`,
        metadata: { found: false },
      };
    }
    const raw = await readFile(fp, "utf-8");
    const data = JSON.parse(raw);
    const m = data.meta || {};
    return {
      title: m.title || args.name,
      output: raw,
      metadata: {
        found: true,
        name: args.name,
        title: m.title || args.name,
        auditType: m.auditType,
        totalFindings: m.totalFindings,
        criticalCount: m.criticalCount,
        highCount: m.highCount,
        mediumCount: m.mediumCount,
        lowCount: m.lowCount,
        infoCount: m.infoCount,
        summary: m.summary,
        overallStatus: m.overallStatus,
        scope,
      },
    };
  },
};
