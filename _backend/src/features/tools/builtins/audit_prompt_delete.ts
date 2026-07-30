import { z } from "zod";
import type { ToolDef } from "../types";
import { deletePrompt, resolveAuditPromptsDir } from "../../../rest/audit-prompts";

export const auditPromptDeleteTool: ToolDef = {
  name: "audit_prompt_delete",
  description: "Delete an audit prompt preset by id.",
  permissionDefault: "allow",
  outputFields: [
    { name: "deleted", type: "boolean", description: "Whether the prompt was deleted", required: true },
  ],
  inputSchema: z.object({
    id: z.string().min(1).describe("Prompt id (slug) to delete"),
  }),
  execute: async (args, ctx) => {
    const promptsDir = resolveAuditPromptsDir(ctx.dataDir);
    try {
      const ok = await deletePrompt(promptsDir, args.id);
      if (!ok) {
        return {
          title: "Not found",
          output: `Prompt "${args.id}" not found.`,
          metadata: { deleted: false },
        };
      }
      return {
        title: "Audit prompt deleted",
        output: `Deleted audit prompt "${args.id}".`,
        metadata: { deleted: true },
      };
    } catch (e) {
      return {
        title: "Failed to delete prompt",
        output: `Error deleting prompt "${args.id}": ${(e as Error).message}`,
        metadata: { deleted: false },
      };
    }
  },
};
