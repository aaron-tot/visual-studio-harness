/**
 * Builtin `edit` tool — self-contained ctx entry.
 * Exact string replacement in a file; replace_all=true for every match.
 * Failure path uses ctx.findClosestMatch/ctx.formatSuggestion for a fuzzy
 * suggestion. Only node:fs is imported directly.
 */
import { readFile } from "node:fs/promises";

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata?: Record<string, unknown> }> {
  const path = String(args.path ?? "");
  const oldString = String(args.old_string ?? "");
  const newString = String(args.new_string ?? "");
  const replaceAll = args.replace_all === true;

  const abs = await ctx.resolveAccessiblePath(path);

  let text: string;
  try {
    text = await readFile(abs, "utf-8");
  } catch {
    throw new ctx.SandboxError(
      `ERROR edit: file not found: ${path}. Use write to create new files.`
    );
  }

  const count = ctx.countOccurrences(text, oldString);
  if (count === 0) {
    const closest = ctx.findClosestMatch(text, oldString);
    if (closest && !closest.ambiguous) {
      throw new ctx.SandboxError(
        `ERROR edit: old_string not found in ${path}.\n` +
          ctx.formatSuggestion(closest, oldString),
        {
          suggestion: true,
          suggestionScore: closest.score,
          suggestionLines: closest.actualLines.length,
        }
      );
    }
    throw new ctx.SandboxError(
      `ERROR edit: old_string not found in ${path}. Include exact surrounding context.`
    );
  }
  if (!replaceAll && count !== 1) {
    throw new ctx.SandboxError(
      `ERROR edit: old_string matched ${count} times in ${path}. Expand unique context or set replace_all=true.`
    );
  }

  const next = replaceAll
    ? text.split(oldString).join(newString)
    : text.replace(oldString, newString);

  await ctx.atomicWriteFile(abs, next);

  return {
    title: path,
    output: `Edited ${path} (${replaceAll ? count : 1} replacement(s))`,
    metadata: { replacements: replaceAll ? count : 1 },
  };
}
