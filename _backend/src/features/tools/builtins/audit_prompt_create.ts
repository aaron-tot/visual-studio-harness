import { z } from "zod";
import type { ToolDef } from "../types";
import { createPrompt, resolveAuditPromptsDir } from "../../../rest/audit-prompts";

export const auditPromptCreateTool: ToolDef = {
  name: "audit_prompt_create",
  description: "Create a reusable audit prompt preset. Prompts appear in the Audits tab sidebar for copy/inject.",
  permissionDefault: "allow",
  outputFields: [
    { name: "created", type: "boolean", description: "Whether the prompt was created", required: true },
    { name: "id", type: "string", description: "The prompt id", required: false },
  ],
  inputSchema: z.object({
    id: z.string().min(1).describe("Unique slug id for the prompt (e.g. 'my-custom-audit')"),
    name: z.string().min(1).describe("Human-readable name shown in the UI"),
    description: z.string().optional().describe("Short description of what this audit checks"),
    category: z.enum(["general", "implementation"]).optional().describe("Prompt category (default: general)"),
    auditType: z.string().optional().describe("AuditCategory value (default: custom)"),
    endGoal: z.string().optional().describe("The end goal / mission statement for general audits"),
    templateInstructions: z.string().min(1).describe("Instructions the agent follows when running this audit"),
  }),
  execute: async (args, ctx) => {
    const promptsDir = resolveAuditPromptsDir(ctx.dataDir);
    try {
      const result = await createPrompt(promptsDir, {
        id: args.id,
        name: args.name,
        description: args.description || "",
        category: (args.category || "general") as "general" | "implementation",
        auditType: args.auditType || "custom",
        endGoal: args.endGoal,
        templateInstructions: args.templateInstructions,
      });
      return {
        title: "Audit prompt created",
        output: `Created audit prompt "${args.name}" (id: ${args.id}, category: ${args.category || "general"}).`,
        metadata: { created: true, id: result.prompt.id },
      };
    } catch (e) {
      return {
        title: "Failed to create audit prompt",
        output: `Error: ${(e as Error).message}`,
        metadata: { created: false },
      };
    }
  },
};
