/**
 * Builtin `read` tool — self-contained ctx entry.
 * Reads a file with numbered lines; offset/limit for large files; rejects binary.
 * All harness helpers come through `ctx` (resolveAccessiblePath, SandboxError,
 * formatNumberedLines); only node:fs is imported directly.
 */
import { readFile } from "node:fs/promises";

const BINARY_SNIFF_BYTES = 8192;
const DEFAULT_READ_MAX_LINES = 2000;

function looksBinary(buf: Buffer): boolean {
  return buf.indexOf(0, 0, BINARY_SNIFF_BYTES) !== -1;
}

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata?: Record<string, unknown> }> {
  const path = String(args.path ?? "");
  const abs = await ctx.resolveAccessiblePath(path);

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "ENOENT") {
      throw new ctx.SandboxError(`ERROR read: file not found: ${path}`);
    }
    if (code === "EISDIR") {
      throw new ctx.SandboxError(`ERROR read: path is a directory: ${path}`);
    }
    throw new ctx.SandboxError(
      `ERROR read: ${err instanceof Error ? err.message : "failed to read file"}`
    );
  }

  if (looksBinary(buf)) {
    throw new ctx.SandboxError(
      `ERROR read: binary or non-text file: ${path} (${buf.length} bytes). Use a different approach for binary data.`
    );
  }

  const text = buf.toString("utf-8");
  const allLines = text.split(/\r?\n/);
  // If file ends with newline, split leaves trailing empty - keep as-is for accuracy
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const limit = typeof args.limit === "number" ? args.limit : DEFAULT_READ_MAX_LINES;

  if (offset >= allLines.length) {
    return {
      title: path,
      output: `(File has ${allLines.length} lines; offset ${offset} is past end)`,
    };
  }

  const slice = allLines.slice(offset, offset + limit);
  const body = ctx.formatNumberedLines(slice, offset + 1);
  const endExclusive = offset + slice.length;
  let footer = "";
  if (endExclusive < allLines.length) {
    footer = `\n\n(File has more lines. Use offset=${endExclusive} to continue. Total lines: ${allLines.length})`;
  } else if (allLines.length === 0 || (allLines.length === 1 && allLines[0] === "")) {
    return {
      title: path,
      output: "(empty file)",
    };
  }

  return {
    title: path,
    output: body + footer,
    metadata: {
      path: abs,
      offset,
      linesReturned: slice.length,
      totalLines: allLines.length,
    },
  };
}
