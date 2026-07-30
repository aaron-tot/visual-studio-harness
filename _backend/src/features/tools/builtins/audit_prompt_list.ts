import { z } from "zod";
import type { ToolDef } from "../types";
import { listPromptEntries, resolveAuditPromptsDir } from "../../../rest/audit-prompts";

export const auditPromptListTool: ToolDef = {
  name: "audit_prompt_list",
  description: "List all audit prompt presets available in the Audits tab.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "number", description: "Number of prompts", required: true },
  ],
  inputSchema: z.object({
    category: z.enum(["general", "implementation"]).optional().describe("Filter by category"),
  }),
  execute: async (args, ctx) => {
    const promptsDir = resolveAuditPromptsDir(ctx.dataDir);
    const entries = await listPromptEntries(promptsDir);
    const filtered = args.category
      ? entries.filter((e) => e.prompt.category === args.category)
      : entries;
    const lines = filtered.map(
      (e) => `  - ${e.prompt.id}: ${e.prompt.name} (${e.prompt.category}, ${e.prompt.auditType})`
    );
    return {
      title: "Audit prompts",
      output: `${filtered.length} audit prompt(s):\n` + lines.join("\n"),
      metadata: { count: filtered.length },
    };
  },
};
