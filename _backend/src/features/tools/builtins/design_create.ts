import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { createSpecDocument, createPlanDocument } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

export const designCreateTool: ToolDef = {
  name: "design_create",
  description: "Create a new spec or plan document for a design. A spec defines what to build (goal, requirements, constraints). A plan defines how to build it (implementation steps, execution config). Returns the file path and version number so you can read it back and fill in parts.",
  permissionDefault: "allow",
  outputFields: [
    { name: "action", type: "string", description: "Result action (always 'created')", required: true },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was created", required: true },
    { name: "name", type: "string", description: "Design directory name", required: true },
    { name: "version", type: "integer", description: "Version number of the new document", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the created file", required: true },
  ],
  inputSchema: z.object({
    name: z.string().min(1).describe("Directory name for this design (e.g. 'auth-system')"),
    type: z.enum(["spec", "plan"]).describe("Document type: 'spec' for specifications (what), 'plan' for implementation plans (how)"),
    goal: z.string().optional().describe("For specs: the goal statement. For plans: the end-goal. Omit to leave empty."),
    specReference: z.string().optional().describe("For plans only: name of the spec this plan implements"),
    scope: z.enum(["global", "project", "session"]).optional().describe("Scope (default: global)"),
    content: z.record(z.unknown()).optional().describe(
      "Optional full or partial document body. Fields here override the default empty template. " +
      "Keys for specs: goal, requirements (string[]), constraints (string[]), assumptions (string[]), acceptanceCriteria (string[]), parts (SpecPlanPart[]). " +
      "Keys for plans: endGoal, tags (string[]), parts (SpecPlanPart[]). " +
      "The 'meta' key is ignored and auto-generated. " +
      "Parts support recursive nesting: { id, name, type, description, status, dependencies, parts }. " +
      "Omit to get a bare skeleton (default behavior)."
    ),
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
      return { title: "Spec created", output: `Created spec v${result.version} for design "${args.name}" at ${result.path}`,
        metadata: { action: "created", type: "spec", name: args.name, version: result.version, path: result.path } };
    } else {
      const result = await createPlanDocument({
        name: args.name, endGoal: args.goal || "", dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId, createdBy: "agent", specReference: args.specReference,
        scope,
        content: args.content,
      });
      return { title: "Plan created", output: `Created plan v${result.version} for design "${args.name}" at ${result.path}`,
        metadata: { action: "created", type: "plan", name: args.name, version: result.version, path: result.path } };
    }
  },
};
