import { z } from "zod";
import type { ToolDef } from "../types";
import { getWorkspaceGraphDbPath } from "../../../core/workspaceGraph/config";
import { openWorkspaceGraphDb } from "../../../core/workspaceGraph/storage/db";
import { createWorkspaceGraphRepository } from "../../../core/workspaceGraph/storage/repository";
import { createQueryApi } from "../../../core/workspaceGraph/api/query";

export const graphImportsTool: ToolDef = {
  name: "graph_imports",
  description:
    "List all import statements for a file. Returns module paths, imported symbols, and import types (default, named, namespace, sideEffect).",
  permissionDefault: "allow",
  inputSchema: z.object({
    file_path: z.string().describe("File path relative to workspace root"),
  }),
  execute: async (args, ctx) => {
    const dbPath = getWorkspaceGraphDbPath(ctx.workspaceRoot);
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);
    const api = createQueryApi(db, repo);
    const imports = await api.listImports(args.file_path);
    if (imports.length === 0) {
      return { title: "graph_imports", output: `No imports in ${args.file_path}` };
    }
    const lines = imports.map(
      (imp) => `${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`
    );
    return { title: "graph_imports", output: lines.join("\n") };
  },
};
