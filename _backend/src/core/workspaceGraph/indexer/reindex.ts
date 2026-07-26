import { scanWorkspace } from "../scanner/scan";
import { parseWorkspaceFile } from "../parser/parse-file";
import { openWorkspaceGraphDb } from "../storage/db";
import { createWorkspaceGraphRepository, type WorkspaceGraphRepository } from "../storage/repository";
import { getParserProject, resetParserProject } from "../parser/project";
import { applyFileUpdate } from "./apply-file-update";
import type { ScanInput, FolderRow } from "../types";

export interface ReindexInput {
  workspaceRoot: string;
  dbPath: string;
  mode: "startup" | "full";
  includeExtensions?: string[];
  excludeDirs?: string[];
}

export interface ReindexReport {
  reindexedPaths: string[];
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  skippedCount: number;
}

export async function reindexWorkspace(input: ReindexInput): Promise<ReindexReport> {
  const { workspaceRoot, dbPath, includeExtensions, excludeDirs } = input;
  const db = openWorkspaceGraphDb(dbPath);
  const repo = createWorkspaceGraphRepository(db);

  const existingIndex = await repo.listIndexedFiles();
  const scanResult = await scanWorkspace({
    workspaceRoot,
    existingIndex,
    includeExtensions,
    excludeDirs,
  });

  if (scanResult.created.length === 0 && scanResult.modified.length === 0 && scanResult.deleted.length === 0) {
    return {
      reindexedPaths: [],
      createdCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      skippedCount: scanResult.unchanged.length,
    };
  }

  const project = getParserProject();
  const reindexedPaths: string[] = [];

  for (const file of scanResult.created) {
    const parsed = await parseWorkspaceFile(file, 0);
    await applyFileUpdate(repo, file, parsed);
    reindexedPaths.push(file.path);
  }

  for (const file of scanResult.modified) {
    const parsed = await parseWorkspaceFile(file, 0);
    await applyFileUpdate(repo, file, parsed);
    reindexedPaths.push(file.path);
  }

  for (const file of scanResult.deleted) {
    await repo.deleteFileByPath(file.path);
    reindexedPaths.push(file.path + " (deleted)");
  }

  // Derive folder hierarchy from all indexed file paths
  const allFiles = await repo.listIndexedFiles();
  const folderSet = new Set<string>();
  for (const file of allFiles) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join("/"));
    }
  }
  if (folderSet.size > 0) {
    const folderRows: FolderRow[] = Array.from(folderSet).map((path) => ({
      path,
      parentId: null,
    }));
    await repo.upsertFolders(folderRows);
  }

  return {
    reindexedPaths,
    createdCount: scanResult.created.length,
    modifiedCount: scanResult.modified.length,
    deletedCount: scanResult.deleted.length,
    skippedCount: scanResult.unchanged.length,
  };
}