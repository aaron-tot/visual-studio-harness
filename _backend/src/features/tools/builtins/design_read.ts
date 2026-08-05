import { z } from "zod";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import type { ToolDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

const SPEC_RE = /^specV(\d+)\.json$/;
const PLAN_RE = /^planV(\d+)\.json$/;

/** Prefer explicit scope; otherwise search session → project → global. */
function resolveDesignDir(
  name: string,
  dataDir: string,
  scope: DesignsScope | undefined,
  workspaceRoot?: string,
  sessionId?: string,
): { dir: string; scope: DesignsScope } | null {
  if (scope) {
    const dir = resolveDesignsDir(dataDir, scope, workspaceRoot, sessionId);
    if (!dir) return null;
    const pd = join(dir, name);
    return existsSync(pd) ? { dir: pd, scope } : null;
  }
  const order: DesignsScope[] = [];
  if (sessionId) order.push("session");
  if (workspaceRoot) order.push("project");
  order.push("global");
  for (const sc of order) {
    const base = resolveDesignsDir(dataDir, sc, workspaceRoot, sessionId);
    if (!base) continue;
    const pd = join(base, name);
    if (existsSync(pd)) return { dir: pd, scope: sc };
  }
  return null;
}

export const designReadTool: ToolDef = {
  name: "design_read",
  description: "Read a spec or plan document from a design directory. See skill:design.",
  permissionDefault: "allow",
  outputFields: [
    { name: "found", type: "boolean", description: "Whether the document was found", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the document (only when found)", required: false },
    { name: "name", type: "string", description: "Design directory name (only when found)", required: false },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was read (only when found)", required: false },
    { name: "version", type: "integer", description: "Version read (only when found)", required: false },
    { name: "allVersions", type: "integer[]", description: "All available versions for this doc type (only when found)", required: false },
    { name: "scope", type: "enum(global | project | session)", description: "Scope the design was found in", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name"),
    type: z.enum(["spec", "plan"]).describe("Document type"),
    version: z.number().int().positive().optional().describe("Version (omit for latest)"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (omit to search session→project→global)"),
  }),
  execute: async (args, ctx) => {
    const pattern = args.type === "spec" ? SPEC_RE : PLAN_RE;
    const found = resolveDesignDir(
      args.name,
      ctx.dataDir,
      args.scope as DesignsScope | undefined,
      ctx.workspaceRoot,
      ctx.sessionId,
    );
    if (!found) {
      return {
        title: "Not found",
        output: `Design "${args.name}" not found${args.scope ? ` in "${args.scope}" scope` : " in session/project/global scopes"}`,
        metadata: { found: false },
      };
    }
    const pd = found.dir;
    const entries = await readdir(pd);
    const matched: { version: number; file: string }[] = [];
    for (const f of entries) {
      const m = f.match(pattern);
      if (m) matched.push({ version: parseInt(m[1], 10), file: f });
    }
    if (matched.length === 0) {
      return {
        title: "No documents",
        output: `No ${args.type} documents in "${args.name}"`,
        metadata: { found: false },
      };
    }
    matched.sort((a, b) => a.version - b.version);
    const target = args.version != null
      ? matched.find((m) => m.version === args.version)
      : matched[matched.length - 1];
    if (!target) {
      const available = matched.map((m) => m.version).join(", ");
      return {
        title: "Not found",
        output:
          args.version == null
            ? `No ${args.type} versions in "${args.name}"`
            : `${args.type} v${args.version} not found in "${args.name}". Available: ${available || "none"}. Omit version to read latest.`,
        metadata: { found: false, allVersions: matched.map((m) => m.version) },
      };
    }
    const raw = await readFile(join(pd, target.file), "utf-8");
    return {
      title: `${args.name} ${args.type} v${target.version}`,
      output: raw,
      metadata: {
        found: true,
        path: join(pd, target.file),
        name: args.name,
        type: args.type,
        version: target.version,
        allVersions: matched.map((m) => m.version),
        scope: found.scope,
      },
    };
  },
};
