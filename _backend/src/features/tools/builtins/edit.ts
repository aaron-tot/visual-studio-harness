import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { resolveAccessiblePath } from "../path-access";
import { atomicWriteFile } from "../host/atomic-write";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + needle.length;
  }
  return count;
}

export const editTool: ToolDef = {
  name: "edit",
  description:
    "Exact string replacement in a file. By default old_string must match exactly once (high success rate). Set replace_all=true to replace every match. Prefer apply_patch for multi-hunk edits.",
  permissionDefault: "ask",
  outputFields: [
    { name: "path", type: "string", description: "Path to the edited file", required: true },
    { name: "replaced", type: "boolean", description: "Whether a replacement was made", required: true },
    { name: "replaceAll", type: "boolean", description: "Whether replace_all mode was used", required: false },
  ],
  inputSchema: z.object({
    path: z.string().describe("File path relative to workspace"),
    old_string: z.string().describe("Exact text to find"),
    new_string: z.string().describe("Replacement text"),
    replace_all: z
      .boolean()
      .optional()
      .describe("If true, replace all occurrences (default false)"),
  }),
  execute: async (args, ctx) => {
    const abs = await resolveAccessiblePath(ctx, args.path);
    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      throw new SandboxError(`ERROR edit: file not found: ${args.path}. Use write to create new files.`);
    }

    const count = countOccurrences(text, args.old_string);
    if (count === 0) {
      throw new SandboxError(
        `ERROR edit: old_string not found in ${args.path}. Include exact surrounding context.`
      );
    }
    if (!args.replace_all && count !== 1) {
      throw new SandboxError(
        `ERROR edit: old_string matched ${count} times in ${args.path}. Expand unique context or set replace_all=true.`
      );
    }

    const next = args.replace_all
      ? text.split(args.old_string).join(args.new_string)
      : text.replace(args.old_string, args.new_string);

    await atomicWriteFile(abs, next);
    return {
      title: args.path,
      output: `Edited ${args.path} (${args.replace_all ? count : 1} replacement(s))`,
      metadata: { replacements: args.replace_all ? count : 1 },
    };
  },
};
