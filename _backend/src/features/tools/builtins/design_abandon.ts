import { z } from "zod";
import { join } from "node:path";
import { readFile, writeFile as writeFileAsync } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope, DesignMeta } from "../../../rest/plans";

export const designAbandonTool: ToolDef = {
  name: "design_abandon",
  description: "Mark a design as abandoned with a reason and optional successor.",
  permissionDefault: "allow",
  outputFields: [
    { name: "abandoned", type: "boolean", description: "Whether the abort succeeded", required: true },
    { name: "name", type: "string", description: "Design abandoned", required: true },
    { name: "reason", type: "string", description: "Why it was abandoned", required: true },
    { name: "successor", type: "string", description: "Replacement design, if any", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name"),
    reason: z.string().min(1).describe("Why this design is being abandoned"),
    successor: z.string().optional().describe("Replacement design name"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (omit to find existing)"),
  }),
  execute: async (args, ctx) => {
    // Prefer explicit scope; else find existing design session→project→global.
    const tryScopes: DesignsScope[] = [];
    if (args.scope) tryScopes.push(args.scope as DesignsScope);
    else {
      if (ctx.sessionId) tryScopes.push("session");
      if (ctx.workspaceRoot) tryScopes.push("project");
      tryScopes.push("global");
    }
    let pd: string | null = null;
    for (const sc of tryScopes) {
      const base = resolveDesignsDir(ctx.dataDir, sc, ctx.workspaceRoot, ctx.sessionId);
      if (!base) continue;
      const candidate = join(base, args.name);
      if (existsSync(candidate)) {
        pd = candidate;
        break;
      }
    }
    if (!pd) {
      return { title: "Not found", output: `Design "${args.name}" not found`, metadata: { abandoned: false } };
    }
    const metaPath = join(pd, "meta.json");
    let meta: DesignMeta = {};
    try { const raw = await readFile(metaPath, "utf-8"); meta = JSON.parse(raw); } catch {}
    meta.abandoned = { reason: args.reason, successor: args.successor || undefined, timestamp: new Date().toISOString() };
    await writeFileAsync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    return { title: "Design abandoned", output: `"${args.name}" abandoned. Reason: ${args.reason}`,
      metadata: { abandoned: true, name: args.name, reason: args.reason, successor: args.successor || null } };
  },
};
