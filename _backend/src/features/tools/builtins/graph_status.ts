import { z } from "zod";
import type { ToolDef } from "../types";
import { getWorkspaceGraphDbPath } from "../../../core/workspaceGraph/config";
import { openWorkspaceGraphDb } from "../../../core/workspaceGraph/storage/db";
import { createWorkspaceGraphRepository } from "../../../core/workspaceGraph/storage/repository";
import { createQueryApi } from "../../../core/workspaceGraph/api/query";

export const graphStatusTool: ToolDef = {
  name: "graph_status",
  description:
    "Check the workspace graph status: current state (idle/indexing/watching), indexed file count, folder count, symbol count, languages supported, and last index time.",
  permissionDefault: "allow",
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    const dbPath = getWorkspaceGraphDbPath(ctx.workspaceRoot);
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);
    const api = createQueryApi(db, repo);
    const summary = await api.workspaceSummary();
    const lines = [
      `Files: ${summary.fileCount}`,
      `Folders: ${summary.folderCount}`,
      `Symbols: ${summary.symbolCount}`,
      `Languages: ${summary.languages.join(", ") || "none"}`,
      `Last indexed: ${summary.lastIndexedAt ? new Date(summary.lastIndexedAt).toISOString() : "never"}`,
      `DB path: ${dbPath}`,
    ];
    return { title: "graph_status", output: lines.join("\n") };
  },
};
