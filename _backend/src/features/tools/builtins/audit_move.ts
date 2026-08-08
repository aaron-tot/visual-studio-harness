import { z } from "zod";
import type { ToolDef } from "../types";
import { moveAudit, findAuditScope } from "../../../rest/audits";

export const auditMoveTool: ToolDef = {
  name: "audit_move",
  description:
    "Move an audit document to another scope (global/project/session). " +
    "fromScope is optional — when omitted the existing audit is resolved (session→project→global).",
  permissionDefault: "allow",
  inputSchema: z.object({
    name: z.string().min(1).describe("Audit directory name (slug)"),
    fromScope: z.enum(["global", "project", "session"]).optional().describe("Source scope"),
    toScope: z.enum(["global", "project", "session"]).describe("Target scope"),
  }),
  execute: async (args, ctx) => {
    try {
      const fromScope =
        args.fromScope ??
        (await findAuditScope(args.name, ctx.dataDir, ctx.workspaceRoot, ctx.sessionId));
      if (!fromScope) {
        return {
          title: "Move failed",
          output: `Audit "${args.name}" not found in any scope`,
          isError: true,
        };
      }
      const r = await moveAudit({
        name: args.name,
        fromScope,
        toScope: args.toScope,
        dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      return {
        title: "Audit moved",
        output: `Moved audit "${args.name}" from ${fromScope} to ${args.toScope} scope.`,
        metadata: r,
      };
    } catch (err) {
      return {
        title: "Move failed",
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  },
};
