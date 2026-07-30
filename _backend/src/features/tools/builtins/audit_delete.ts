import { z } from "zod";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { resolveAuditsDir } from "../../../rest/audits";

export const auditDeleteTool: ToolDef = {
  name: "audit_delete",
  description:
    "Delete an audit document by name within a scope. Removes the entire audit directory.",
  permissionDefault: "allow",
  outputFields: [
    { name: "deleted", type: "boolean", description: "Whether the audit was deleted", required: true },
    { name: "name", type: "string", description: "Audit name", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Audit name (directory slug, unique within scope)"),
    scope: z
      .enum(["global", "project", "session"])
      .optional()
      .describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
    const auditsDir = resolveAuditsDir(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (!auditsDir) {
      return {
        title: "Error",
        output: `Cannot resolve audits directory for scope "${scope}".`,
        metadata: { deleted: false },
        isError: true,
      };
    }
    const nd = join(auditsDir, args.name);
    if (!existsSync(nd)) {
      return {
        title: "Not found",
        output: `Audit "${args.name}" not found in "${scope}" scope.`,
        metadata: { deleted: false },
      };
    }
    await rm(nd, { recursive: true, force: true });
    return {
      title: "Audit deleted",
      output: `Deleted audit "${args.name}" from "${scope}" scope.`,
      metadata: { deleted: true, name: args.name },
    };
  },
};
