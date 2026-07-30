import { z } from "zod";
import type { ToolDef } from "../types";
import { readPrompt, resolveAuditPromptsDir } from "../../../rest/audit-prompts";

export const auditPromptReadTool: ToolDef = {
  name: "audit_prompt_read",
  description: "Read a specific audit prompt preset by id.",
  permissionDefault: "allow",
  outputFields: [
    { name: "found", type: "boolean", description: "Whether the prompt was found", required: true },
  ],
  inputSchema: z.object({
    id: z.string().min(1).describe("Prompt id (slug) to read"),
  }),
  execute: async (args, ctx) => {
    const promptsDir = resolveAuditPromptsDir(ctx.dataDir);
    const result = await readPrompt(promptsDir, args.id);
    if (!result) {
      return {
        title: "Prompt not found",
        output: `No prompt found with id "${args.id}".`,
        metadata: { found: false },
      };
    }
    return {
      title: `Prompt: ${result.prompt.name}`,
      output: JSON.stringify(result.prompt, null, 2),
      metadata: { found: true },
    };
  },
};
