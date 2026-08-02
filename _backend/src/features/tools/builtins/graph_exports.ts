import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphExportsTool: ToolDef = {
  name: "graph_exports",
  description:
    "List all export statements for a file. Returns exported symbol names and whether they are default exports.",
  permissionDefault: "allow",
  outputFields: [
    { name: "symbol", type: "string", description: "Exported symbol name", required: true },
    { name: "isDefault", type: "boolean", description: "Whether this is a default export", required: true },
  ],
  inputSchema: z.object({
    file_path: z.string().describe("File path relative to workspace root"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_exports", output: "Graph service not available", isError: true };
    }
    const exports = await ctx.graphService.query.listExports(args.file_path);
    if (exports.length === 0) {
      return { title: "graph_exports", output: `No exports in ${args.file_path}` };
    }
    const lines = exports.map(
      (exp) => `${exp.isDefault ? "default " : ""}${exp.symbol}`
    );
    return { title: "graph_exports", output: lines.join("\n") };
  },
};
