import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { createSpecDocument, createPlanDocument } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

export const designCreateTool: ToolDef = {
  name: "design_create",
  description:
    "Create a new spec or plan document for a design. " +
    "See skill:design for the document structure. " +
    "READ skill:design BEFORE use. Non-standard content keys are preserved under customContent and reported.",
  permissionDefault: "allow",
  outputFields: [
    { name: "action", type: "string", description: "Result action (always 'created')", required: true },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was created", required: true },
    { name: "name", type: "string", description: "Design directory name", required: true },
    { name: "version", type: "integer", description: "Version number of the new document", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the created file", required: true },
    { name: "customKeys", type: "string[]", description: "Non-standard content keys saved under customContent", required: false },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name"),
    type: z.enum(["spec", "plan"]).describe("spec = what to build, plan = how to build"),
    goal: z.string().optional().describe("Goal or end-goal"),
    specReference: z.string().optional().describe("Spec name this plan implements"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope"),
    content: z.record(z.unknown()).optional().describe("Document body; see skill:design. Non-standard keys are kept under customContent."),
  }),
  execute: async (args, ctx) => {
    const scope = (args.scope || "global") as DesignsScope;
    if (args.type === "spec") {
      const result = await createSpecDocument({
        name: args.name, goal: args.goal || "", dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId, createdBy: "agent",
        scope,
        content: args.content,
      });
      const note = customNote(result.customKeys);
      return { title: "Spec created", output: `Created spec v${result.version} for design "${args.name}" at ${result.path}${note}`,
        metadata: { action: "created", type: "spec", name: args.name, version: result.version, path: result.path, customKeys: result.customKeys } };
    } else {
      const result = await createPlanDocument({
        name: args.name, endGoal: args.goal || "", dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId, createdBy: "agent", specReference: args.specReference,
        scope,
        content: args.content,
      });
      const note = customNote(result.customKeys);
      return { title: "Plan created", output: `Created plan v${result.version} for design "${args.name}" at ${result.path}${note}`,
        metadata: { action: "created", type: "plan", name: args.name, version: result.version, path: result.path, customKeys: result.customKeys } };
    }
  },
};

function customNote(customKeys: string[]): string {
  if (!customKeys.length) return "";
  const keys = customKeys.join(", ");
  return ` [note: ${customKeys.length} non-standard content key${customKeys.length === 1 ? " was" : "s were"} saved under customContent: ${keys}]`;
}
