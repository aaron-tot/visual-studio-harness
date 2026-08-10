import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scanWorkspace } from "../scanner/scan";
import { isIgnored, isSourceFile, getLanguage } from "../scanner/ignore";
import { computeSourceHash } from "../scanner/hash";
import { parseWorkspaceFile } from "../parser/parse-file";
import { openWorkspaceGraphDb } from "../storage/db";
import { createWorkspaceGraphRepository, type WorkspaceGraphRepository } from "../storage/repository";
import { getParserProject, resetParserProject, REINDEX_PROJECT_RESET_INTERVAL } from "../parser/project";
import { applyFileUpdate } from "./apply-file-update";
import type { FolderRow } from "../types";

export interface ReindexInput {
  workspaceRoot: string;
  dbPath: string;
  mode: "startup" | "full";
  /** When set, skip full scan and process only these watch-event paths */
  changedPaths?: string[];
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

  let project = getParserProject();
  let filesProcessed = 0;
  const reindexedPaths: string[] = [];

  const resetProjectIfNeeded = () => {
    filesProcessed++;
    if (filesProcessed % REINDEX_PROJECT_RESET_INTERVAL === 0) {
      resetParserProject();
      project = getParserProject();
    }
  };

  if (input.changedPaths && input.changedPaths.length > 0) {
    // --- Incremental mode: only process files reported by the watcher ---
    const exts = includeExtensions ?? [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    const exDirs = excludeDirs ?? ["node_modules", ".git", "dist", "build", ".vsh", "coverage", ".turbo"];
    const resolvedRoot = resolve(workspaceRoot);

    let createdCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let skippedCount = 0;

    for (const relPath of input.changedPaths) {
      // Filter out ignored dirs and non-source files
      if (isIgnored(relPath, exDirs)) { skippedCount++; continue; }
      const filename = relPath.split("/").pop() ?? relPath;
      if (!isSourceFile(filename, exts)) { skippedCount++; continue; }

      const fullPath = join(resolvedRoot, relPath);

      let st;
      try {
        st = await stat(fullPath);
      } catch {
        // file no longer on disk — deleted
        const existing = await repo.findFileByPath(relPath);
        if (existing) {
          await repo.deleteFileByPath(relPath);
          reindexedPaths.push(relPath + " (deleted)");
          deletedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      if (st.isDirectory()) { skippedCount++; continue; }

      try {
        const sourceText = await readFile(fullPath, "utf-8");
        const fileHash = computeSourceHash(sourceText);
        const dot = filename.lastIndexOf(".");
        const ext = dot > 0 ? filename.slice(dot) : "unknown";

        const existing = await repo.findFileByPath(relPath);

        const scanned = {
          path: relPath,
          filename,
          extension: ext,
          language: getLanguage(ext),
          size: st.size,
          modifiedMs: st.mtimeMs,
          fileHash,
          sourceText,
        };

        const parsed = await parseWorkspaceFile(scanned, 0, project);
        await applyFileUpdate(repo, scanned, parsed);
        reindexedPaths.push(relPath);
        resetProjectIfNeeded();

        if (existing) {
          modifiedCount++;
        } else {
          createdCount++;
        }
      } catch {
        skippedCount++;
      }
    }

    // Derive folder hierarchy from all indexed file paths
    const allFilesAfter = await repo.listIndexedFiles();
    const folderSet = new Set<string>();
    for (const file of allFilesAfter) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join("/"));
      }
    }
    if (folderSet.size > 0) {
      const folderRows: FolderRow[] = Array.from(folderSet).map((path) => ({ path, parentId: null }));
      await repo.upsertFolders(folderRows);
    }

    resetParserProject();

    return {
      reindexedPaths,
      createdCount,
      modifiedCount,
      deletedCount,
      skippedCount,
    };
  }

  // --- Full scan mode (startup / reindexAll) ---
  const existingIndex = await repo.listIndexedFiles();
  const scanResult = await scanWorkspace({
    workspaceRoot,
    existingIndex,
    includeExtensions,
    excludeDirs,
  });

  if (scanResult.created.length === 0 && scanResult.modified.length === 0 && scanResult.deleted.length === 0) {
    resetParserProject();
    return {
      reindexedPaths: [],
      createdCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      skippedCount: scanResult.unchanged.length,
    };
  }

  for (const file of scanResult.created) {
    const parsed = await parseWorkspaceFile(file, 0, project);
    await applyFileUpdate(repo, file, parsed);
    reindexedPaths.push(file.path);
    resetProjectIfNeeded();
  }

  for (const file of scanResult.modified) {
    const parsed = await parseWorkspaceFile(file, 0, project);
    await applyFileUpdate(repo, file, parsed);
    reindexedPaths.push(file.path);
    resetProjectIfNeeded();
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

  // Reset singleton so the next getParserProject() call creates a fresh Project
  resetParserProject();

  return {
    reindexedPaths,
    createdCount: scanResult.created.length,
    modifiedCount: scanResult.modified.length,
    deletedCount: scanResult.deleted.length,
    skippedCount: scanResult.unchanged.length,
  };
}
