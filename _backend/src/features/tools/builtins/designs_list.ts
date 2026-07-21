import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { listDesigns } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

export const designsListTool: ToolDef = {
  name: "designs_list",
  description: "List all design directories in a scope (global, project, or session). Returns each design name, path, and available spec/plan versions. Use this to discover existing designs before reading or editing them.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of designs found", required: true },
    { name: "scope", type: "enum(global | project | session)", description: "Scope that was queried", required: true },
    { name: "designs", type: "object[]", description: "Array of designs, each with name, path, specVersions, planVersions", required: false },
  ],
  inputSchema: z.object({
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope to list from (default: global)"),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as DesignsScope;
    const entries = await listDesigns(ctx.dataDir, scope, ctx.workspaceRoot, ctx.sessionId);
    if (entries.length === 0) {
      return { title: "No designs", output: `No designs found in "${scope}" scope. Use design_create to create one.`, metadata: { count: 0, scope } };
    }
    const lines = entries.map((e) => {
      const sv = e.specs.map((s) => `v${s.meta.version}`).join(", ") || "none";
      const pv = e.plans.map((p) => `v${p.meta.version}`).join(", ") || "none";
      return `  ${e.name}/  (specs: ${sv}, plans: ${pv})`;
    });
    return { title: `${entries.length} design(s) in ${scope} scope`, output: lines.join("\n"),
      metadata: { count: entries.length, scope, designs: entries.map((e) => ({ name: e.name, path: e.path, specVersions: e.specs.map((s) => s.meta.version), planVersions: e.plans.map((p) => p.meta.version) })) } };
  },
};
