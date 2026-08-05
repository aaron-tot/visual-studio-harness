import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { resolveAccessiblePath } from "../path-access";
import { atomicWriteFile } from "../host/atomic-write";
import { countOccurrences } from "../format";
import { findClosestMatch, formatSuggestion } from "../host/fuzzy-match";

export const editTool: ToolDef = {
  name: "edit",
  description: "Exact string replacement in a file; replace_all=true for every match.",
  permissionDefault: "ask",
  outputFields: [
    { name: "path", type: "string", description: "Path to edited file", required: true },
    { name: "replaced", type: "boolean", description: "Whether a replacement was made", required: true },
    { name: "replaceAll", type: "boolean", description: "Whether replace_all was used", required: false },
  ],
  inputSchema: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z
      .boolean()
      .optional()
      .describe("Replace all occurrences (default false)"),
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
      const closest = findClosestMatch(text, args.old_string);
      if (closest && !closest.ambiguous) {
        throw new SandboxError(
          `ERROR edit: old_string not found in ${args.path}.\n` + formatSuggestion(closest, args.old_string),
          { suggestion: true, suggestionScore: closest.score, suggestionLines: closest.actualLines.length }
        );
      }
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
