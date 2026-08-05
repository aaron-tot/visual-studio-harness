import { z } from "zod";
import { join } from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

/**
 * Deep-merge `patch` into `target` per RFC 7396 (JSON Merge Patch).
 *
 * - Plain objects: recurse
 * - Arrays & primitives: replace
 * - `null` in patch: delete key from target
 */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(target)) {
    out[key] = target[key];
  }
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === null) {
      delete out[key];
    } else if (
      typeof pv === "object" &&
      !Array.isArray(pv) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(
        out[key] as Record<string, unknown>,
        pv as Record<string, unknown>,
      );
    } else {
      out[key] = pv;
    }
  }
  return out;
}

const SPEC_RE = /^specV(\d+)\.json$/;
const PLAN_RE = /^planV(\d+)\.json$/;

function resolveDesignDir(
  name: string,
  dataDir: string,
  scope: DesignsScope | undefined,
  workspaceRoot?: string,
  sessionId?: string,
): { dir: string; scope: DesignsScope } | null {
  if (scope) {
    const base = resolveDesignsDir(dataDir, scope, workspaceRoot, sessionId);
    if (!base) return null;
    const pd = join(base, name);
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

async function latestVersion(dir: string, type: "spec" | "plan"): Promise<number | null> {
  const pattern = type === "spec" ? SPEC_RE : PLAN_RE;
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  let max = 0;
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max > 0 ? max : null;
}

export const designEditTool: ToolDef = {
  name: "design_edit",
  description:
    "Edit a spec/plan: provide `document` (full replace) or `patch` (RFC 7396 merge). " +
    "Omit version to edit the latest. See skill:design-edit for merge semantics.",
  permissionDefault: "allow",
  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the update succeeded", required: true },
    { name: "name", type: "string", description: "Design directory name", required: true },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was edited", required: true },
    { name: "version", type: "integer", description: "Version that was edited", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the document", required: true },
    { name: "scope", type: "enum(global | project | session)", description: "Scope written to", required: false },
  ],
  inputSchema: z
    .object({
      name: z.string().min(1).describe("Design directory name"),
      type: z.enum(["spec", "plan"]).describe("Document type"),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Version number to edit (omit for latest)"),
      scope: z.enum(["global", "project", "session"]).optional().describe("Scope (omit to find existing)"),
      document: z
        .record(z.unknown())
        .optional()
        .describe("Full replacement document JSON"),
      patch: z
        .record(z.unknown())
        .optional()
        .describe("Partial doc to merge (RFC 7396)"),
    })
    .refine((d) => !(d.document && d.patch), {
      message: "Provide either `document` (full replace) or `patch` (merge), not both",
    })
    .refine((d) => d.document || d.patch, {
      message: "Provide either `document` (full replace) or `patch` (merge)",
    }),
  execute: async (args, ctx) => {
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
        metadata: { updated: false },
        isError: true,
      };
    }

    let version = args.version as number | undefined;
    if (version == null) {
      const latest = await latestVersion(found.dir, args.type);
      if (latest == null) {
        return {
          title: "Not found",
          output: `No ${args.type} versions in "${args.name}". Pass version explicitly after creating one.`,
          metadata: { updated: false },
          isError: true,
        };
      }
      version = latest;
    }

    const fp = join(found.dir, `${args.type}V${version}.json`);
    if (!existsSync(fp)) {
      const latest = await latestVersion(found.dir, args.type);
      return {
        title: "Not found",
        output:
          `${args.type} v${version} not found in "${args.name}".` +
          (latest != null ? ` Latest available: v${latest}. Omit version to edit latest.` : " No versions exist."),
        metadata: { updated: false },
        isError: true,
      };
    }

    let doc: Record<string, unknown>;

    if (args.patch) {
      const raw = await readFile(fp, "utf-8");
      const current = JSON.parse(raw) as Record<string, unknown>;
      doc = deepMerge(current, args.patch);
    } else {
      doc = args.document!;
    }

    if (doc.meta && typeof doc.meta === "object") {
      const meta = doc.meta as Record<string, unknown>;
      meta.updatedAt = new Date().toISOString();
      meta.updatedBy = "agent";
      if (meta.version == null) meta.version = version;
    }

    await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");

    return {
      title: "Design updated",
      output: `Updated ${args.name} ${args.type} v${version} (${found.scope})${args.patch ? " (patch mode)" : ""}`,
      metadata: {
        updated: true,
        name: args.name,
        type: args.type,
        version,
        path: fp,
        scope: found.scope,
      },
    };
  },
};
