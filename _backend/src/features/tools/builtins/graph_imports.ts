import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphImportsTool: ToolDef = {
  name: "graph_imports",
  description:
    "List all import statements for a file. Returns module paths, imported symbols, and import types (default, named, namespace, sideEffect).",
  permissionDefault: "allow",
  outputFields: [
    { name: "module", type: "string", description: "Imported module path", required: true },
    { name: "importType", type: "string", description: "Import type (default, named, namespace, sideEffect)", required: true },
    { name: "symbols", type: "string[]", description: "Imported symbol names", required: false },
  ],
  inputSchema: z.object({
    file_path: z.string().describe("File path relative to workspace root"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_imports", output: "Graph service not available", isError: true };
    }
    const imports = await ctx.graphService.query.listImports(args.file_path);
    if (imports.length === 0) {
      return { title: "graph_imports", output: `No imports in ${args.file_path}` };
    }
    const lines = imports.map(
      (imp) => `${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`
    );
    return { title: "graph_imports", output: lines.join("\n") };
  },
};
