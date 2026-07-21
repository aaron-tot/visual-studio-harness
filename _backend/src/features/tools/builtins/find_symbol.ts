import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveAccessiblePath } from "../path-access";
import { findSymbols } from "../host/symbols";

export const findSymbolTool: ToolDef = {
  name: "find_symbol",
  description:
    "Find code symbol definitions (functions/classes/types) by name substring. Prefer this over grep+read loops. Returns path:line and kind.",
  permissionDefault: "allow",
  outputFields: [
    { name: "query", type: "string", description: "The symbol name searched", required: true },
    { name: "count", type: "integer", description: "Number of matching symbols found", required: true },
  ],
  inputSchema: z.object({
    query: z.string().describe("Symbol name or substring"),
    path: z.string().optional().describe("Limit search to a file or subdirectory"),
    head_limit: z.number().int().min(1).max(100).optional().describe("Max hits (default 20)"),
  }),
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? await resolveAccessiblePath(ctx, args.path)
      : undefined;
    const hits = await findSymbols({
      workspaceRoot: ctx.workspaceRoot,
      query: args.query,
      path: searchPath,
      headLimit: args.head_limit ?? 20,
    });
    if (hits.length === 0) {
      return { title: "find_symbol", output: `No symbols matching '${args.query}'` };
    }
    const lines = hits.map(
      (h) => `${h.path}:${h.line}-${h.endLine} ${h.kind} ${h.name}  ${h.preview}`
    );
    return { title: "find_symbol", output: lines.join("\n") };
  },
};
