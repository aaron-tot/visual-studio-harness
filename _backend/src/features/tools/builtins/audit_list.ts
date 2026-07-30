import { z } from "zod";
import type { ToolDef } from "../types";
import { listAudits } from "../../../rest/audits";

export const auditListTool: ToolDef = {
  name: "audit_list",
  description:
    "List audit documents in a scope (global, project, or session). Each audit has meta info " +
    "including title, auditType, summary, finding counts, and severity distribution.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of audits found", required: true },
    { name: "scope", type: "string", description: "Scope that was queried", required: true },
  ],
  inputSchema: z.object({
    scope: z
      .enum(["global", "project", "session"])
      .optional()
      .describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const entries = await listAudits(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (entries.length === 0) {
      return {
        title: "No audits",
        output: `No audits found in "${scope}" scope.`,
        metadata: { count: 0, scope },
      };
    }
    const lines = entries.map(
      (e) =>
        `  ${e.name}  — ${e.document.meta.title} (${e.document.meta.auditType}, ${e.document.meta.totalFindings} findings)`
    );
    return {
      title: `${entries.length} audit(s) in ${scope} scope`,
      output: lines.join("\n"),
      metadata: { count: entries.length, scope },
    };
  },
};
