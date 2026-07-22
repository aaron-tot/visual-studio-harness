import type { WorkspaceGraphServiceInput } from "./types";
import type { WorkspaceGraphService } from "./api/types";
import { NotInitializedError } from "./errors";

export async function createWorkspaceGraphService(
  input: WorkspaceGraphServiceInput
): Promise<WorkspaceGraphService> {
  let started = false;

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
      started = true;
    },
    async stop() {
      started = false;
    },
    async reindexAll() {
      if (!started) throw new NotInitializedError();
    },
    query: queryApi,
    manifest: manifestApi,
  };
}