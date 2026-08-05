import { z } from "zod";
import type { ToolDef } from "../types";
import { listDesigns, type DesignsScope } from "../../../rest/plans";
import { listNotes } from "../../../rest/notes";
import { listAudits } from "../../../rest/audits";
import { getKbService } from "./knowledge_common";

type Scope = "global" | "project" | "session";
type Feature = "designs" | "notes" | "audits" | "knowledge";

const SCOPES: Scope[] = ["global", "project", "session"];

interface ScopeResult {
  scope: Scope;
  lines: string[];
}

async function runForScopes(
  fetchFn: (scope: Scope) => Promise<string[]>,
  explicitScope: Scope | undefined,
): Promise<ScopeResult[]> {
  const scopes = explicitScope ? [explicitScope] : SCOPES;
  return Promise.all(
    scopes.map(async (s) => ({
      scope: s,
      lines: await fetchFn(s),
    })),
  );
}

interface GroupData {
  feature: Feature;
  scope: Scope;
  count: number;
  lines: string[];
}

export const listTool: ToolDef = {
  name: "list",
  description:
    "List designs, notes, audits, and knowledge docs. Omit feature/scope to aggregate. For knowledge docs pass a `configs` array.",
  permissionDefault: "allow",
  outputFields: [
    { name: "totalCount", type: "integer", description: "Total items across all groups", required: true },
    { name: "groups", type: "object[]", description: "Array of { feature, scope, count }", required: true },
  ],
  inputSchema: z.object({
    feature: z.enum(["designs", "notes", "audits", "knowledge"] as const).optional(),
    scope: z.enum(["global", "project", "session"] as const).optional(),
    configs: z
      .array(
        z.object({
          extension: z.string().optional(),
          status: z.enum(["pending", "processing", "ready", "failed"] as const).optional(),
          createdBy: z.string().optional(),
        }),
      )
      .optional(),
  }),
  execute: async (args, ctx) => {
    const explicitScope = args.scope as Scope | undefined;
    const feature = args.feature as Feature | undefined;
    const configs = args.configs ?? [];
    const groups: GroupData[] = [];
    let totalCount = 0;

    const features: Feature[] = feature ? [feature] : ["designs", "notes", "audits", "knowledge"];

    for (const feat of features) {
      const scopeResults = await runForScopes(async (s) => {
        switch (feat) {
          case "designs": {
            const entries = await listDesigns(ctx.dataDir, s as DesignsScope, ctx.workspaceRoot, ctx.sessionId);
            return entries.map((e) => {
              const sv = e.specs.map((sp) => `v${sp.meta?.version ?? "?"}`).join(", ") || "none";
              const pv = e.plans.map((p) => `v${p.meta?.version ?? "?"}`).join(", ") || "none";
              return `  ${e.name}/  (specs: ${sv}, plans: ${pv})`;
            });
          }
          case "notes": {
            const entries = await listNotes(ctx.dataDir, s, ctx.workspaceRoot, ctx.sessionId);
            return entries.map((e) => `  ${e.name}  — ${e.title}`);
          }
          case "audits": {
            const entries = await listAudits(ctx.dataDir, s, ctx.workspaceRoot, ctx.sessionId);
            return entries.map(
              (e) =>
                `  ${e.name}  — ${e.document.meta.title} (${e.document.meta.auditType}, ${e.document.meta.totalFindings} findings)`,
            );
          }
          case "knowledge": {
            const kb = getKbService();
            const configsArr = configs.length > 0 ? configs : [undefined];
            const lines: string[] = [];
            for (const config of configsArr) {
              const docs = await kb.listDocuments(
                s,
                {
                  extension: config?.extension,
                  status: config?.status,
                  createdBy: config?.createdBy,
                },
                ctx.workspaceRoot,
                ctx.sessionId,
              );
              for (const d of docs) {
                lines.push(
                  `  ID:${d.id}  ${d.filename}  (${d.extension ?? ""}, ${d.fileSize} bytes, status: ${d.status}` +
                    `${d.tags?.length ? `, tags: ${d.tags.join(", ")}` : ""}` +
                    `${d.createdBy ? `, by: ${d.createdBy}` : ""})`,
                );
              }
            }
            return lines;
          }
        }
      }, explicitScope);

      for (const sr of scopeResults) {
        if (sr.lines.length === 0) continue;
        totalCount += sr.lines.length;
        groups.push({ feature: feat, scope: sr.scope, count: sr.lines.length, lines: sr.lines });
      }
    }

    if (totalCount === 0) {
      const scopeLabel = explicitScope ? ` in "${explicitScope}" scope` : " across all scopes";
      const featureLabel = feature ? ` ${feature}` : " designs, notes, audits, and knowledge";
      return {
        title: "No results",
        output: `No${featureLabel} found${scopeLabel}.`,
        metadata: { count: 0, groups: [] },
      };
    }

    const lines: string[] = [];
    for (const g of groups) {
      lines.push(`## ${g.feature} (${g.scope}): ${g.count} item(s)`);
      lines.push(...g.lines);
      lines.push("");
    }

    return {
      title: `${totalCount} item(s) across ${groups.length} group(s)`,
      output: lines.join("\n").trimEnd(),
      metadata: {
        totalCount,
        groups: groups.map((g) => ({ feature: g.feature, scope: g.scope, count: g.count })),
      },
    };
  },
};
