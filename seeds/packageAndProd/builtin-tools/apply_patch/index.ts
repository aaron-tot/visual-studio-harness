/**
 * Builtin `apply_patch` tool — self-contained ctx entry.
 * Applies a multi-file patch (*** Add/Update/Delete File) via ctx.applyPatchText.
 */
export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
  const patchText = String(args.patchText ?? "");

  const result = await ctx.applyPatchText(ctx.workspaceRoot, patchText, (p: string) =>
    ctx.resolveAccessiblePath(p)
  );

  return {
    title: "apply_patch",
    output: result.summary,
    metadata: { files: result.touched },
  };
}
