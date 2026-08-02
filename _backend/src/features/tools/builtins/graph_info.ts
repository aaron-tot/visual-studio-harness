import { z } from "zod";
import type { ToolDef } from "../types";

export const graphInfoTool: ToolDef = {
  name: "graph_info",
  description:
    "Get detailed info for a specific file: its imports, exports, and symbols. Returns structured data about what the file depends on and what it exposes.",
  permissionDefault: "allow",
  inputSchema: z.object({
    file_path: z.string().describe("File path relative to workspace root"),
  }),
  execute: async (args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_info", output: "Graph service not available", isError: true };
    }
    const [imports, exports, symbols] = await Promise.all([
      ctx.graphService.query.listImports(args.file_path),
      ctx.graphService.query.listExports(args.file_path),
      ctx.graphService.query.findSymbolsByFile(args.file_path),
    ]);

    const sections: string[] = [];

    sections.push(`File: ${args.file_path}`);
    sections.push(`Symbols: ${symbols.length}`);
    if (symbols.length > 0) {
      for (const s of symbols) {
        sections.push(`  ${s.symbol.kind} ${s.symbol.name} L${s.symbol.startLine}-${s.symbol.endLine}`);
      }
    }

    sections.push(`Imports: ${imports.length}`);
    if (imports.length > 0) {
      for (const imp of imports) {
        sections.push(`  ${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`);
      }
    }

    sections.push(`Exports: ${exports.length}`);
    if (exports.length > 0) {
      for (const exp of exports) {
        sections.push(`  ${exp.isDefault ? "default " : ""}${exp.symbol}`);
      }
    }

    return { title: "graph_info", output: sections.join("\n") };
  },
};
