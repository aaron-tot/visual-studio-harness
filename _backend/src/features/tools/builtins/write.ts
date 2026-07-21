import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveAccessiblePath } from "../path-access";
import { atomicWriteFile } from "../host/atomic-write";

export const writeTool: ToolDef = {
  name: "write",
  description:
    "Create or overwrite a file (atomic write). Paths relative to workspace, or absolute/~ with external_directory permission. Returns path and size only — not file contents.",
  permissionDefault: "ask",
  outputFields: [
    { name: "path", type: "string", description: "Absolute path to the written file", required: true },
    { name: "bytes", type: "integer", description: "Number of bytes written", required: true },
    { name: "lines", type: "integer", description: "Number of lines written", required: true },
  ],
  inputSchema: z.object({
    path: z.string().describe("File path (relative to workspace, absolute, or ~/...)"),
    content: z.string().describe("Full file contents to write"),
  }),
  execute: async (args, ctx) => {
    const abs = await resolveAccessiblePath(ctx, args.path);
    await atomicWriteFile(abs, args.content);
    const bytes = Buffer.byteLength(args.content, "utf-8");
    const lines = args.content.length === 0 ? 0 : args.content.split(/\r?\n/).length;
    return {
      title: args.path,
      output: `Wrote ${args.path} (${bytes} bytes, ${lines} lines)`,
      metadata: { path: abs, bytes, lines },
    };
  },
};
