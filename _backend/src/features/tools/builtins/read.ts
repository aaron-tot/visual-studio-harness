import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { resolveAccessiblePath } from "../path-access";
import {
  DEFAULT_READ_MAX_LINES,
  formatNumberedLines,
} from "../format";

const BINARY_SNIFF_BYTES = 8192;

function looksBinary(buf: Buffer): boolean {
  return buf.indexOf(0, 0, BINARY_SNIFF_BYTES) !== -1;
}

export const readTool: ToolDef = {
  name: "read",
  description: "Read a file (numbered lines; offset/limit for large files; cannot read binary).",
  permissionDefault: "allow",
  outputFields: [
    { name: "path", type: "string", description: "Absolute path read", required: true },
    { name: "truncated", type: "boolean", description: "Output truncated by line limit", required: false },
  ],
  inputSchema: z.object({
    path: z.string(),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-based start line"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(DEFAULT_READ_MAX_LINES)
      .optional()
      .describe(`Max lines (default ${DEFAULT_READ_MAX_LINES})`),
  }),
  execute: async (args, ctx) => {
    const abs = await resolveAccessiblePath(ctx, args.path);
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "ENOENT") {
        throw new SandboxError(`ERROR read: file not found: ${args.path}`);
      }
      if (code === "EISDIR") {
        throw new SandboxError(`ERROR read: path is a directory: ${args.path}`);
      }
      throw new SandboxError(
        `ERROR read: ${err instanceof Error ? err.message : "failed to read file"}`
      );
    }

    if (looksBinary(buf)) {
      throw new SandboxError(
        `ERROR read: binary or non-text file: ${args.path} (${buf.length} bytes). Use a different approach for binary data.`
      );
    }

    const text = buf.toString("utf-8");
    const allLines = text.split(/\r?\n/);
    // If file ends with newline, split leaves trailing empty - keep as-is for accuracy
    const offset = args.offset ?? 0;
    const limit = args.limit ?? DEFAULT_READ_MAX_LINES;

    if (offset >= allLines.length) {
      return {
        title: args.path,
        output: `(File has ${allLines.length} lines; offset ${offset} is past end)`,
      };
    }

    const slice = allLines.slice(offset, offset + limit);
    const body = formatNumberedLines(slice, offset + 1);
    const endExclusive = offset + slice.length;
    let footer = "";
    if (endExclusive < allLines.length) {
      footer = `\n\n(File has more lines. Use offset=${endExclusive} to continue. Total lines: ${allLines.length})`;
    } else if (allLines.length === 0 || (allLines.length === 1 && allLines[0] === "")) {
      return {
        title: args.path,
        output: "(empty file)",
      };
    }

    // Prefer workspace-relative display in title
    return {
      title: args.path,
      output: body + footer,
      metadata: {
        path: abs,
        offset,
        linesReturned: slice.length,
        totalLines: allLines.length,
      },
    };
  },
};
