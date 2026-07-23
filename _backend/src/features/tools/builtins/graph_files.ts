import { z } from "zod";
import type { ToolDef } from "../types";
import { getWorkspaceGraphDbPath } from "../../../core/workspaceGraph/config";
import { openWorkspaceGraphDb } from "../../../core/workspaceGraph/storage/db";
import { createWorkspaceGraphRepository } from "../../../core/workspaceGraph/storage/repository";
import { createQueryApi } from "../../../core/workspaceGraph/api/query";

export const graphFilesTool: ToolDef = {
  name: "graph_files",
  description:
    "List all indexed source files in the workspace. Returns file paths, languages, sizes, and modification times. Use folder_path to list files in a specific subdirectory.",
  permissionDefault: "allow",
  inputSchema: z.object({
    folder_path: z
      .string()
      .optional()
      .describe("Optional subdirectory to list (relative to workspace root)"),
  }),
  execute: async (args, ctx) => {
    const dbPath = getWorkspaceGraphDbPath(ctx.workspaceRoot);
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);
    const api = createQueryApi(db, repo);
    const files = await api.listFiles(args.folder_path);
    if (files.length === 0) {
      return { title: "graph_files", output: "No indexed files found" };
    }
    const lines = files.map(
      (f) => `${f.path} [${f.language}] ${f.size}B modified=${new Date(f.modifiedMs).toISOString()}`
    );
    return { title: "graph_files", output: `${files.length} files:\n${lines.join("\n")}` };
  },
};
