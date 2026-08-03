import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveAccessiblePath } from "../path-access";
import { atomicWriteFile } from "../host/atomic-write";

export const writeTool: ToolDef = {
  name: "write",
  description: "Create or overwrite a file (atomic write). Returns path and size only.",
  permissionDefault: "ask",
  outputFields: [
    { name: "path", type: "string", description: "Absolute path written", required: true },
    { name: "bytes", type: "integer", description: "Bytes written", required: true },
    { name: "lines", type: "integer", description: "Lines written", required: true },
  ],
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
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
