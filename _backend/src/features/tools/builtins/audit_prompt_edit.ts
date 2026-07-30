import { z } from "zod";
import type { ToolDef } from "../types";
import { editPrompt, resolveAuditPromptsDir } from "../../../rest/audit-prompts";

export const auditPromptEditTool: ToolDef = {
  name: "audit_prompt_edit",
  description: "Edit an existing audit prompt preset (update name, description, category, auditType, endGoal, or templateInstructions).",
  permissionDefault: "allow",
  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the update succeeded", required: true },
  ],
  inputSchema: z.object({
    id: z.string().min(1).describe("Prompt id (slug) to edit"),
    name: z.string().optional().describe("New human-readable name"),
    description: z.string().optional().describe("New description"),
    category: z.enum(["general", "implementation"]).optional().describe("New category"),
    auditType: z.string().optional().describe("New AuditCategory value"),
    endGoal: z.string().optional().describe("New end goal (set to empty string to clear)"),
    templateInstructions: z.string().optional().describe("New template instructions"),
  }),
  execute: async (args, ctx) => {
    const promptsDir = resolveAuditPromptsDir(ctx.dataDir);

    // Only pass defined fields
    const updates: Record<string, string | undefined> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.category !== undefined) updates.category = args.category;
    if (args.auditType !== undefined) updates.auditType = args.auditType;
    if (args.endGoal !== undefined) updates.endGoal = args.endGoal;
    if (args.templateInstructions !== undefined) updates.templateInstructions = args.templateInstructions;

    try {
      const result = await editPrompt(promptsDir, args.id, updates as Parameters<typeof editPrompt>[2]);
      if (!result) {
        return {
          title: "Not found",
          output: `Prompt "${args.id}" not found.`,
          metadata: { updated: false },
        };
      }
      return {
        title: "Audit prompt updated",
        output: `Updated audit prompt "${args.id}".`,
        metadata: { updated: true },
      };
    } catch (e) {
      return {
        title: "Failed to edit prompt",
        output: `Error editing prompt "${args.id}": ${(e as Error).message}`,
        metadata: { updated: false },
      };
    }
  },
};
