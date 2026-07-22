import type { WorkspaceGraphServiceInput } from "./types";
import type { WorkspaceGraphService } from "./api/types";
import { NotInitializedError } from "./errors";
import { getWorkspaceGraphDbPath } from "./config";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb } from "./storage/db";
import { createWorkspaceGraphRepository } from "./storage/repository";
import { reindexWorkspace } from "./indexer/reindex";

export async function createWorkspaceGraphService(
  input: WorkspaceGraphServiceInput
): Promise<WorkspaceGraphService> {
  let started = false;
  let _dbPath: string | null = null;

  const queryApi = {
    async findSymbol(_name: string, _kind?: string) {
      return [];
    },
    async findFunction(_name: string) {
      return [];
    },
    async findClass(_name: string) {
      return [];
    },
    async findInterface(_name: string) {
      return [];
    },
    async listImports(_filePath: string) {
      return [];
    },
    async listExports(_filePath: string) {
      return [];
    },
    async listFiles(_folderPath?: string) {
      return [];
    },
    async listFolders(_parentPath?: string) {
      return [];
    },
    async workspaceSummary() {
      return { fileCount: 0, folderCount: 0, symbolCount: 0, languages: [], lastIndexedAt: 0 };
    },
  };

  const manifestApi = {
    async workspaceManifest(_options?: Record<string, unknown>) {
      return "";
    },
    async workspaceManifestFiles(_options?: Record<string, unknown>) {
      return "";
    },
    async workspaceManifestFolders(_options?: Record<string, unknown>) {
      return "";
    },
    async workspaceSummary() {
      return "";
    },
  };

  return {
    async start() {
      if (started) return;
      started = true;

      _dbPath = getWorkspaceGraphDbPath(input.workspaceRoot);
      openWorkspaceGraphDb(_dbPath);

      const report = await reindexWorkspace({
        workspaceRoot: input.workspaceRoot,
        dbPath: _dbPath,
        mode: "startup",
      });

      console.log(
        `[workspace-graph] startup index: ${report.createdCount} created, ${report.modifiedCount} modified, ${report.deletedCount} deleted, ${report.skippedCount} skipped`
      );
    },
    async stop() {
      if (!started) return;
      started = false;
      if (_dbPath) {
        closeWorkspaceGraphDb(_dbPath);
        _dbPath = null;
      }
    },
    async reindexAll() {
      if (!started) throw new NotInitializedError();
      const dbPath = getWorkspaceGraphDbPath(input.workspaceRoot);
      const report = await reindexWorkspace({
        workspaceRoot: input.workspaceRoot,
        dbPath,
        mode: "full",
      });
      console.log(
        `[workspace-graph] reindexAll: ${report.createdCount} created, ${report.modifiedCount} modified, ${report.deletedCount} deleted, ${report.skippedCount} skipped`
      );
    },
    query: queryApi,
    manifest: manifestApi,
  };
}