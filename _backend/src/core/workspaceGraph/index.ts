import { logMemory } from "../../utils/memory";
import type { WorkspaceGraphServiceInput } from "./types";
import type { WorkspaceGraphService } from "./api/types";
import { NotInitializedError } from "./errors";
import { getWorkspaceGraphDbPath } from "./config";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb, type WorkspaceGraphDb } from "./storage/db";
import { createWorkspaceGraphRepository } from "./storage/repository";
import { reindexWorkspace } from "./indexer/reindex";
import { createQueryApi } from "./api/query";
import { createManifestApi } from "./api/manifest";
import { startWorkspaceWatcher, type WorkspaceWatcherHandle } from "./watcher/watch";
import type { WorkspaceFsEvent } from "./watcher/events";

export async function createWorkspaceGraphService(
  input: WorkspaceGraphServiceInput
): Promise<WorkspaceGraphService> {
  let started = false;
  let state: "idle" | "indexing" | "watching" = "idle";
  let _db: WorkspaceGraphDb | null = null;
  let _dbPath: string | null = null;
  let _watcher: WorkspaceWatcherHandle | null = null;

  const queryApi = {
    async findSymbol(_name: string, _kind?: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).findSymbol(_name, _kind);
    },
    async findFunction(_name: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).findFunction(_name);
    },
    async findClass(_name: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).findClass(_name);
    },
    async findInterface(_name: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).findInterface(_name);
    },
    async listImports(_filePath: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).listImports(_filePath);
    },
    async listExports(_filePath: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).listExports(_filePath);
    },
    async listFiles(_folderPath?: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).listFiles(_folderPath);
    },
    async listFolders(_parentPath?: string) {
      if (!_db) return [];
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).listFolders(_parentPath);
    },
    async workspaceSummary() {
      if (!_db) return { fileCount: 0, folderCount: 0, symbolCount: 0, languages: [], lastIndexedAt: 0 };
      return createQueryApi(_db, createWorkspaceGraphRepository(_db)).workspaceSummary();
    },
  };

  const manifestApi = {
    async workspaceManifest(_options?: Record<string, unknown>) {
      if (!_db) return "";
      return createManifestApi(_db).workspaceManifest(_options as any);
    },
    async workspaceManifestFiles(_options?: Record<string, unknown>) {
      if (!_db) return "";
      return createManifestApi(_db).workspaceManifestFiles(_options as any);
    },
    async workspaceManifestFolders(_options?: Record<string, unknown>) {
      if (!_db) return "";
      return createManifestApi(_db).workspaceManifestFolders(_options as any);
    },
    async workspaceSummary() {
      if (!_db) return "";
      return createManifestApi(_db).workspaceSummary();
    },
  };

  return {
    async start() {
      if (started) return;
      started = true;
      state = "indexing";

      _dbPath = getWorkspaceGraphDbPath(input.workspaceRoot);
      _db = openWorkspaceGraphDb(_dbPath);

      const report = await reindexWorkspace({
        workspaceRoot: input.workspaceRoot,
        dbPath: _dbPath,
        mode: "startup",
      });

      console.log(
        `[workspace-graph] startup index: ${report.createdCount} created, ${report.modifiedCount} modified, ${report.deletedCount} deleted, ${report.skippedCount} skipped`
      );
      logMemory("after startup reindex");

      if (input.enableWatcher !== false) {
        _watcher = await startWorkspaceWatcher({
          workspaceRoot: input.workspaceRoot,
          debounceMs: input.debounceMs ?? 50,
          onBatch: async (events: WorkspaceFsEvent[]) => {
            await processWatcherBatch(input.workspaceRoot, _dbPath!, events);
          },
        });
        console.log(`[workspace-graph] watcher started (debounce ${input.debounceMs ?? 50}ms)`);
      }

      state = "watching";
    },
    async stop() {
      if (!started) return;
      started = false;
      state = "idle";
      if (_watcher) {
        await _watcher.close();
        _watcher = null;
      }
      if (_dbPath) {
        closeWorkspaceGraphDb(_dbPath);
        _dbPath = null;
        _db = null;
      }
    },
    async reindexAll() {
      if (!started) throw new NotInitializedError();
      const prevState = state;
      state = "indexing";
      const dbPath = getWorkspaceGraphDbPath(input.workspaceRoot);
      const report = await reindexWorkspace({
        workspaceRoot: input.workspaceRoot,
        dbPath,
        mode: "full",
      });
      state = prevState;
      console.log(
        `[workspace-graph] reindexAll: ${report.createdCount} created, ${report.modifiedCount} modified, ${report.deletedCount} deleted, ${report.skippedCount} skipped`
      );
    },
    async getStatus() {
      const empty = { state, fileCount: 0, folderCount: 0, symbolCount: 0, languages: [] as string[], lastIndexedAt: 0, dbPath: "" };
      if (!_db) return { ...empty, dbPath: _dbPath ?? "" };
      const summary = await createQueryApi(_db, createWorkspaceGraphRepository(_db)).workspaceSummary();
      return { state, ...summary, dbPath: _dbPath ?? "" };
    },
    query: queryApi,
    manifest: manifestApi,
  };
}

async function processWatcherBatch(
  workspaceRoot: string,
  dbPath: string,
  events: WorkspaceFsEvent[]
): Promise<void> {
  // Filter to file-level events only (skip dir events — folders derived from files)
  const changedPaths = events
    .filter((e) => e.type === "add" || e.type === "change" || e.type === "unlink")
    .map((e) => e.path);

  if (changedPaths.length === 0) return;

  const report = await reindexWorkspace({
    workspaceRoot,
    dbPath,
    mode: "startup",
    changedPaths,
  });

  if (report.reindexedPaths.length > 0) {
    console.log(`[workspace-graph] watcher batch: ${report.reindexedPaths.length} file(s) updated`);
    logMemory("after watcher reindex");
  }
}
