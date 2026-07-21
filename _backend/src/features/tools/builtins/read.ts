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
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export const readTool: ToolDef = {
  name: "read",
  description:
    "Read a file from the workspace. Prefer relative paths. Use offset (0-based start line) and limit (default 2000 lines) for large files. Returns numbered lines. Cannot read binary/image files.",
  permissionDefault: "allow",
  outputFields: [
    { name: "path", type: "string", description: "Absolute path to the file that was read", required: true },
    { name: "truncated", type: "boolean", description: "Whether output was truncated due to line limit", required: false },
  ],
  inputSchema: z.object({
    path: z.string().describe("File path (relative, absolute, or ~/...; outside workspace needs external_directory)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-based line offset to start reading from"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(DEFAULT_READ_MAX_LINES)
      .optional()
      .describe(`Max lines to return (default ${DEFAULT_READ_MAX_LINES})`),
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
