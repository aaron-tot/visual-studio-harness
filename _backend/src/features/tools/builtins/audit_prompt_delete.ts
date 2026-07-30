import { z } from "zod";
import type { ToolDef } from "../types";

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
    const url = `${ctx.apiBase || "http://localhost:3001"}/api/audit-prompts/delete`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: args.id }),
    });
    if (!res.ok) {
      return {
        title: "Failed to delete prompt",
        output: `No prompt found with id "${args.id}".`,
        metadata: { deleted: false },
      };
    }
    return {
      title: "Audit prompt deleted",
      output: `Deleted audit prompt "${args.id}".`,
      metadata: { deleted: true },
    };
  },
};
