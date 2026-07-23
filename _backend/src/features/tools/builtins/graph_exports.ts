import { z } from "zod";
import type { ToolDef } from "../types";
import { getWorkspaceGraphDbPath } from "../../../core/workspaceGraph/config";
import { openWorkspaceGraphDb } from "../../../core/workspaceGraph/storage/db";
import { createWorkspaceGraphRepository } from "../../../core/workspaceGraph/storage/repository";
import { createQueryApi } from "../../../core/workspaceGraph/api/query";

export const graphExportsTool: ToolDef = {
  name: "graph_exports",
  description:
    "List all export statements for a file. Returns exported symbol names and whether they are default exports.",
  permissionDefault: "allow",
  inputSchema: z.object({
    file_path: z.string().describe("File path relative to workspace root"),
  }),
  execute: async (args, ctx) => {
    const dbPath = getWorkspaceGraphDbPath(ctx.workspaceRoot);
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);
    const api = createQueryApi(db, repo);
    const exports = await api.listExports(args.file_path);
    if (exports.length === 0) {
      return { title: "graph_exports", output: `No exports in ${args.file_path}` };
    }
    const lines = exports.map(
      (exp) => `${exp.isDefault ? "default " : ""}${exp.symbol}`
    );
    return { title: "graph_exports", output: lines.join("\n") };
  },
};
