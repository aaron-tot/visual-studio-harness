import { z } from "zod";
import type { ToolDef } from "../types";
import { moveDesign, findDesignScope } from "../../../rest/plans";

export const designMoveTool: ToolDef = {
  name: "design_move",
  description:
    "Move a design document to another scope (global/project/session). " +
    "fromScope is optional — when omitted the existing design is resolved (session→project→global).",
  permissionDefault: "allow",
  inputSchema: z.object({
    name: z.string().min(1).describe("Design directory name"),
    fromScope: z.enum(["global", "project", "session"]).optional().describe("Source scope"),
    toScope: z.enum(["global", "project", "session"]).describe("Target scope"),
  }),
  execute: async (args, ctx) => {
    try {
      const fromScope =
        args.fromScope ??
        (await findDesignScope(args.name, ctx.dataDir, ctx.workspaceRoot, ctx.sessionId));
      if (!fromScope) {
        return {
          title: "Move failed",
          output: `Design "${args.name}" not found in any scope`,
          isError: true,
        };
      }
      const r = await moveDesign({
        name: args.name,
        fromScope,
        toScope: args.toScope,
        dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      return {
        title: "Design moved",
        output: `Moved design "${args.name}" from ${fromScope} to ${args.toScope} scope.`,
        metadata: r,
      };
    } catch (err) {
      return {
        title: "Move failed",
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  },
};
