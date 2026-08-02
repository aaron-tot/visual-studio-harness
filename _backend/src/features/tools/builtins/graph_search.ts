import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphSearchTool: ToolDef = {
  name: "graph_search",
  description:
    "Search workspace symbols (functions, classes, interfaces, enums, variables) by name using the indexed workspace graph. Returns symbol name, kind, file path, line range, visibility, and signature. Faster than grep for symbol lookups.",
  permissionDefault: "allow",
  outputFields: [
    { name: "name", type: "string", description: "Symbol name", required: true },
    { name: "kind", type: "string", description: "Symbol kind", required: true },
    { name: "filePath", type: "string", description: "File path", required: true },
    { name: "line", type: "integer", description: "Start line", required: true },
    { name: "endLine", type: "integer", description: "End line", required: true },
    { name: "exported", type: "boolean", description: "Whether exported", required: false },
    { name: "signature", type: "string", description: "Symbol signature", required: false },
  ],
  inputSchema: z.object({
    name: z.string().describe("Symbol name or substring to search for"),
    kind: z
      .enum(["function", "class", "interface", "enum", "variable", "type"])
      .optional()
      .describe("Filter by symbol kind"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_search", output: "Graph service not available", isError: true };
    }
    const matches = await ctx.graphService.query.findSymbol(args.name, args.kind);
    if (matches.length === 0) {
      return { title: "graph_search", output: `No symbols matching '${args.name}'` };
    }
    const lines = matches.map(
      (m) =>
        `${m.symbol.kind} ${m.symbol.name} — ${m.filePath}:${m.symbol.startLine}-${m.symbol.endLine}` +
        (m.symbol.exported ? " [exported]" : "") +
        (m.symbol.async ? " [async]" : "") +
        (m.symbol.signature ? `\n  signature: ${m.symbol.signature}` : "")
    );
    return { title: "graph_search", output: lines.join("\n") };
  },
};
