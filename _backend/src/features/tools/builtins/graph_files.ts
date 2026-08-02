import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphFilesTool: ToolDef = {
  name: "graph_files",
  description:
    "List all indexed source files in the workspace. Returns file paths, languages, sizes, and modification times. Use folder_path to list files in a specific subdirectory.",
  permissionDefault: "allow",
  outputFields: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "language", type: "string", description: "Programming language", required: false },
    { name: "size", type: "integer", description: "File size in bytes", required: false },
    { name: "modifiedMs", type: "integer", description: "Last modified timestamp (ms)", required: false },
  ],
  inputSchema: z.object({
    folder_path: z
      .string()
      .optional()
      .describe("Optional subdirectory to list (relative to workspace root)"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_files", output: "Graph service not available", isError: true };
    }
    const files = await ctx.graphService.query.listFiles(args.folder_path);
    if (files.length === 0) {
      return { title: "graph_files", output: "No indexed files found" };
    }
    const lines = files.map(
      (f) => `${f.path} [${f.language}] ${f.size}B modified=${new Date(f.modifiedMs).toISOString()}`
    );
    return { title: "graph_files", output: `${files.length} files:\n${lines.join("\n")}` };
  },
};
