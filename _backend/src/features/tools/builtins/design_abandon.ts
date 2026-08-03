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
  }),
  execute: async (args, ctx) => {
    const designsDir = resolveDesignsDir(ctx.dataDir, "global" as DesignsScope, ctx.workspaceRoot, ctx.sessionId);
    const pd = join(designsDir, args.name);
    const metaPath = join(pd, "meta.json");
    if (!existsSync(pd)) {
      return { title: "Not found", output: `Design "${args.name}" not found`, metadata: { abandoned: false } };
    }
    let meta: DesignMeta = {};
    try { const raw = await readFile(metaPath, "utf-8"); meta = JSON.parse(raw); } catch {}
    meta.abandoned = { reason: args.reason, successor: args.successor || undefined, timestamp: new Date().toISOString() };
    await writeFileAsync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    return { title: "Design abandoned", output: `"${args.name}" abandoned. Reason: ${args.reason}`,
      metadata: { abandoned: true, name: args.name, reason: args.reason, successor: args.successor || null } };
  },
};
