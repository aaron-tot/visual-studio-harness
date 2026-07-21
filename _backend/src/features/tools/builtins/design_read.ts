import { z } from "zod";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

const SPEC_RE = /^specV(\d+)\.json$/;
const PLAN_RE = /^planV(\d+)\.json$/;

export const designReadTool: ToolDef = {
  name: "design_read",
  description: "Read a spec or plan document from a design directory. Specify the design name and document type. Omit version to get the latest. Returns the full parsed JSON document.",
  permissionDefault: "allow",
  outputFields: [
    { name: "found", type: "boolean", description: "Whether the document was found", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the document (only when found)", required: false },
    { name: "name", type: "string", description: "Design directory name (only when found)", required: false },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was read (only when found)", required: false },
    { name: "version", type: "integer", description: "Version read (only when found)", required: false },
    { name: "allVersions", type: "integer[]", description: "All available versions for this doc type (only when found)", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name (e.g. 'auth-system')"),
    type: z.enum(["spec", "plan"]).describe("Document type to read"),
    version: z.number().int().positive().optional().describe("Version number (omit for latest)"),
  }),
  execute: async (args, ctx) => {
    const pattern = args.type === "spec" ? SPEC_RE : PLAN_RE;
    const designsDir = resolveDesignsDir(ctx.dataDir, "global" as DesignsScope, ctx.workspaceRoot, ctx.sessionId);
    const pd = join(designsDir, args.name);
    const { existsSync } = await import("node:fs");
    if (!existsSync(pd)) {
      return { title: "Not found", output: `Design "${args.name}" not found`, metadata: { found: false } };
    }
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(pd);
    const matched: { version: number; file: string }[] = [];
    for (const f of entries) {
      const m = f.match(pattern);
      if (m) matched.push({ version: parseInt(m[1], 10), file: f });
    }
    if (matched.length === 0) {
      return { title: "No documents", output: `No ${args.type} documents in "${args.name}"`, metadata: { found: false } };
    }
    matched.sort((a, b) => a.version - b.version);
    const target = args.version ? matched.find((m) => m.version === args.version) : matched[matched.length - 1];
    if (!target) {
      return { title: "Not found", output: `${args.type} v${args.version} not found in "${args.name}"`, metadata: { found: false } };
    }
    const raw = await readFile(join(pd, target.file), "utf-8");
    return {
      title: `${args.name} ${args.type} v${target.version}`,
      output: raw,
      metadata: { found: true, path: join(pd, target.file), name: args.name, type: args.type, version: target.version, allVersions: matched.map((m) => m.version) },
    };
  },
};
