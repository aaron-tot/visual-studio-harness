import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { resolveAccessiblePath } from "../path-access";
import { readSymbolRange } from "../host/symbols";
import { formatNumberedLines } from "../format";

export const readSymbolTool: ToolDef = {
  name: "read_symbol",
  description:
    "Read only the source region for a named symbol (definition + optional context lines). Prefer over reading whole files.",
  permissionDefault: "allow",
  outputFields: [
    { name: "name", type: "string", description: "Symbol name that was requested", required: true },
    { name: "path", type: "string", description: "File path where the symbol was found", required: false },
  ],
  inputSchema: z.object({
    name: z.string().describe("Exact or unique symbol name"),
    path: z.string().optional().describe("Disambiguate file/dir"),
    context_lines: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("Extra lines before/after (default 3)"),
  }),
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? await resolveAccessiblePath(ctx, args.path)
      : undefined;
    const hit = await readSymbolRange({
      workspaceRoot: ctx.workspaceRoot,
      name: args.name,
      path: searchPath,
      contextLines: args.context_lines ?? 3,
    });
    if (!hit) {
      throw new SandboxError(`ERROR read_symbol: symbol '${args.name}' not found`);
    }

    const abs = await resolveAccessiblePath(ctx, hit.path);
    const text = await readFile(abs, "utf-8");
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, hit.line - 1);
    // re-find end with context after
    const end = Math.min(lines.length, hit.endLine + (args.context_lines ?? 3));
    const slice = lines.slice(start, end);
    const body = formatNumberedLines(slice, start + 1);
    return {
      title: `${hit.name} @ ${hit.path}:${hit.line}`,
      output: `${hit.kind} ${hit.name} — ${hit.path}:${hit.line}-${end}\n\n${body}`,
    };
  },
};
