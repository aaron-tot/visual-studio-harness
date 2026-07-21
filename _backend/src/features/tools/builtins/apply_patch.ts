import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { applyPatchText } from "../host/patch";

export const applyPatchTool: ToolDef = {
  name: "apply_patch",
  description: `Apply a multi-file patch to the workspace. Format:
*** Add File: relative/path
file contents
*** Update File: relative/path
<<<<<<< SEARCH
exact old text (must match once)
=======
new text
>>>>>>> REPLACE
*** Delete File: relative/path
Prefer this over rewriting whole files.`,
  permissionDefault: "ask",
  outputFields: [
    { name: "files", type: "string[]", description: "List of file paths that were touched by the patch", required: true },
  ],
  inputSchema: z.object({
    patchText: z.string().describe("Patch body using *** Add/Update/Delete File markers"),
  }),
  execute: async (args, ctx) => {
    const { resolveAccessiblePath } = await import("../path-access");
    const result = await applyPatchText(ctx.workspaceRoot, args.patchText, (p) =>
      resolveAccessiblePath(ctx, p)
    );
    return {
      title: "apply_patch",
      output: result.summary,
      metadata: { files: result.touched },
    };
  },
};
