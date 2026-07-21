import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveAccessiblePath } from "../path-access";
import { runFd } from "../host/fd";

export const globTool: ToolDef = {
  name: "glob",
  description:
    "Find files by name/glob pattern (fd, with rg --files fallback). Respects gitignore. Returns relative paths.",
  permissionDefault: "allow",
  outputFields: [
    { name: "pattern", type: "string", description: "The glob pattern searched", required: true },
    { name: "count", type: "integer", description: "Number of files found", required: true },
    { name: "truncated", type: "boolean", description: "Whether results were truncated by head_limit", required: false },
  ],
  inputSchema: z.object({
    pattern: z.string().describe('Glob or filename pattern e.g. "**/*.ts" or "package.json"'),
    path: z.string().optional().describe("Subdirectory to search under workspace"),
    head_limit: z.number().int().min(1).max(1000).optional().describe("Max paths (default 200)"),
  }),
  execute: async (args, ctx) => {
    const searchPath = args.path
      ? await resolveAccessiblePath(ctx, args.path)
      : undefined;
    const limit = args.head_limit ?? 200;

    const { files, truncated } = await runFd({
      pattern: args.pattern,
      cwd: ctx.workspaceRoot,
      path: searchPath,
      headLimit: limit,
      abortSignal: ctx.abortSignal,
    });

    if (files.length === 0) {
      return { title: "glob", output: `No files matching ${args.pattern}` };
    }

    let out = files.join("\n");
    if (truncated) out += `\n\n(truncated: showing first ${limit} paths)`;
    return {
      title: "glob",
      output: out,
      metadata: { count: files.length, truncated },
    };
  },
};
