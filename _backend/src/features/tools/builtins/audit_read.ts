import { z } from "zod";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { resolveAuditsDir } from "../../../rest/audits";

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
      .describe("Scope (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as "global" | "project" | "session";
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
    return {
      title: data.meta?.title || args.name,
      output: raw,
      metadata: { found: true, name: args.name, title: data.meta?.title || args.name },
    };
  },
};
