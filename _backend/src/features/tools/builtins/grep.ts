import { z } from "zod";
import { relative } from "node:path";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveAccessiblePath } from "../path-access";
import { runRipgrep } from "../host/ripgrep";
import { DEFAULT_GREP_MAX_MATCHES, clipLine } from "../format";

export const grepTool: ToolDef = {
  name: "grep",
  description:
    "Search file contents with regex via ripgrep. Respects .gitignore. Prefer this before reading many files. Use path/glob to narrow scope.",
  permissionDefault: "allow",
  outputFields: [
    { name: "pattern", type: "string", description: "The regex pattern searched", required: true },
    { name: "count", type: "integer", description: "Number of matching lines found", required: true },
    { name: "truncated", type: "boolean", description: "Whether results were truncated by head_limit", required: false },
  ],
  inputSchema: z.object({
    pattern: z.string().describe("Regular expression pattern"),
    path: z.string().optional().describe("File or directory under workspace (default: whole workspace)"),
    glob: z.string().optional().describe('File filter e.g. "*.ts"'),
    case_insensitive: z.boolean().optional().describe("Case insensitive search"),
    head_limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(`Max matches (default ${DEFAULT_GREP_MAX_MATCHES})`),
  }),
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? await resolveAccessiblePath(ctx, args.path)
      : ctx.workspaceRoot;
    const limit = args.head_limit ?? DEFAULT_GREP_MAX_MATCHES;

    const { matches, truncated } = await runRipgrep({
      pattern: args.pattern,
      cwd: ctx.workspaceRoot,
      path: searchPath === ctx.workspaceRoot ? undefined : searchPath,
      glob: args.glob,
      caseInsensitive: args.case_insensitive,
      headLimit: limit,
      abortSignal: ctx.abortSignal,
    });

    if (matches.length === 0) {
      return { title: "grep", output: `No matches for /${args.pattern}/` };
    }

    const lines = matches.map((m) => {
      const rel = m.path.startsWith(ctx.workspaceRoot)
        ? relative(ctx.workspaceRoot, m.path)
        : m.path;
      return `${rel}:${m.line}:${clipLine(m.text)}`;
    });

    let out = lines.join("\n");
    if (truncated) out += `\n\n(truncated: showing first ${limit} matches)`;
    return {
      title: "grep",
      output: out,
      metadata: { count: matches.length, truncated },
    };
  },
};
