import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphManifestTool: ToolDef = {
  name: "graph_manifest",
  description:
    "Get the workspace tree as structured text. Shows the folder/file hierarchy of all indexed source files. Use max_depth to limit tree depth.",
  permissionDefault: "allow",
  outputFields: [
    { name: "manifest", type: "string", description: "Workspace tree as structured text", required: true },
  ],
  inputSchema: z.object({
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Max tree depth (default: unlimited)"),
    include_files: z
      .boolean()
      .optional()
      .describe("Include files in output (default: true)"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_manifest", output: "Graph service not available", isError: true };
    }
    const manifest = await ctx.graphService.manifest.workspaceManifest({
      maxDepth: args.max_depth,
      includeFiles: args.include_files,
    });
    if (!manifest) {
      return { title: "graph_manifest", output: "No manifest data (workspace may not be indexed)" };
    }
    return { title: "graph_manifest", output: manifest };
  },
};
