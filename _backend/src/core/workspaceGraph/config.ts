import { resolve } from "node:path";
import { resolveDataDir } from "../../paths";

export function getWorkspaceGraphConfig(workspaceRoot: string) {
  const dbDir = resolve(workspaceRoot, ".vsh");
  const dbPath = resolve(dbDir, "workspace-graph.db");

  return {
    workspaceRoot,
    dbPath,
    enableWatcher: true,
    debounceMs: 50,
    includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    excludeDirs: ["node_modules", ".git", "dist", "build", ".vsh", "coverage", ".turbo"],
  };
}

export function getWorkspaceGraphDbPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".vsh", "workspace-graph.db");
}

export function getWorkspaceGraphDbDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".vsh");
}