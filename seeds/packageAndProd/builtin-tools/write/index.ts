/**
 * Builtin `write` tool — self-contained ctx entry.
 * Creates or overwrites a file atomically via ctx.atomicWriteFile.
 */
export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
  const path = String(args.path ?? "");
  const content = String(args.content ?? "");

  const abs = await ctx.resolveAccessiblePath(path);
  await ctx.atomicWriteFile(abs, content);

  const bytes = Buffer.byteLength(content, "utf-8");
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;

  return {
    title: path,
    output: `Wrote ${path} (${bytes} bytes, ${lines} lines)`,
    metadata: { path: abs, bytes, lines },
  };
}
