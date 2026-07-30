import { z } from "zod";
import type { ToolDef } from "../types";

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
    const url = `${ctx.apiBase || "http://localhost:3001"}/api/audit-prompts/edit`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: args.id,
        name: args.name,
        description: args.description,
        category: args.category,
        auditType: args.auditType,
        endGoal: args.endGoal,
        templateInstructions: args.templateInstructions,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "HTTP " + res.status }));
      return {
        title: "Failed to edit prompt",
        output: `Error: ${err.error || "HTTP " + res.status}`,
        metadata: { updated: false },
      };
    }
    return {
      title: "Audit prompt updated",
      output: `Updated audit prompt "${args.id}".`,
      metadata: { updated: true },
    };
  },
};
