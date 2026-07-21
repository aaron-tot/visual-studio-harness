import { z } from "zod";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

export const designEditTool: ToolDef = {
  name: "design_edit",
  description: "Replace an entire spec or plan document with new content. Provide the full updated JSON. The tool automatically updates meta.updatedAt and meta.updatedBy. Use this after reading with design_read, modifying the JSON, then writing back.",
  permissionDefault: "allow",
  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the update succeeded", required: true },
    { name: "name", type: "string", description: "Design directory name", required: true },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was edited", required: true },
    { name: "version", type: "integer", description: "Version that was edited", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the document", required: true },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name"),
    type: z.enum(["spec", "plan"]).describe("Document type"),
    version: z.number().int().positive().describe("Version number to edit"),
    document: z.record(z.unknown()).describe("The full updated document JSON (must match the schema for this type)"),
  }),
  execute: async (args, ctx) => {
    const designsDir = resolveDesignsDir(ctx.dataDir, "global" as DesignsScope, ctx.workspaceRoot, ctx.sessionId);
    const fp = join(designsDir, args.name, `${args.type}V${args.version}.json`);
    const { existsSync } = await import("node:fs");
    if (!existsSync(fp)) {
      return { title: "Not found", output: `${args.type} v${args.version} not found in "${args.name}"`, metadata: { updated: false } };
    }
    const doc = args.document;
    if (doc.meta && typeof doc.meta === "object") {
      (doc.meta as Record<string, unknown>).updatedAt = new Date().toISOString();
      (doc.meta as Record<string, unknown>).updatedBy = "agent";
    }
    await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
    return { title: "Design updated", output: `Updated ${args.name} ${args.type} v${args.version}`,
      metadata: { updated: true, name: args.name, type: args.type, version: args.version, path: fp } };
  },
};
