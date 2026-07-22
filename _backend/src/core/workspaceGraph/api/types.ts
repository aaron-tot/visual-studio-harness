import type { SymbolKind } from "../types";

export interface SymbolMatch {
  symbol: {
    id: number;
    name: string;
    kind: SymbolKind;
    fileId: number;
    exported: boolean;
    async: boolean;
    static: boolean;
    visibility: "public" | "private" | "protected";
    signature: string | null;
    startLine: number;
    endLine: number;
    structuralHash: string;
  };
  filePath: string;
  fileName: string;
}

export interface FileRecord {
  id: number;
  path: string;
  filename: string;
  extension: string;
  language: string;
  size: number;
  modifiedMs: number;
  fileHash: string;
  indexedAtMs: number;
}

export interface FolderRecord {
  id: number;
  path: string;
  parentId: number | null;
  name: string;
}

export interface ImportRecord {
  module: string;
  symbols: string[];
  importType: "default" | "named" | "namespace" | "sideEffect";
  filePath: string;
}

export interface ExportRecord {
  symbol: string;
  isDefault: boolean;
  filePath: string;
}

export interface WorkspaceSummary {
  fileCount: number;
  folderCount: number;
  symbolCount: number;
  languages: string[];
  lastIndexedAt: number;
}

export interface ManifestOptions {
  maxDepth?: number;
  excludeDirs?: string[];
  excludeExtensions?: string[];
  includeFiles?: boolean;
  includeHidden?: boolean;
}

export interface WorkspaceGraphQueryApi {
  findSymbol(name: string, kind?: SymbolKind): Promise<SymbolMatch[]>;
  findFunction(name: string): Promise<SymbolMatch[]>;
  findClass(name: string): Promise<SymbolMatch[]>;
  findInterface(name: string): Promise<SymbolMatch[]>;
  listImports(filePath: string): Promise<ImportRecord[]>;
  listExports(filePath: string): Promise<ExportRecord[]>;
  listFiles(folderPath?: string): Promise<FileRecord[]>;
  listFolders(parentPath?: string): Promise<FolderRecord[]>;
  workspaceSummary(): Promise<WorkspaceSummary>;
}

export interface WorkspaceManifestApi {
  workspaceManifest(options?: ManifestOptions): Promise<string>;
  workspaceManifestFiles(options?: ManifestOptions): Promise<string>;
  workspaceManifestFolders(options?: ManifestOptions): Promise<string>;
  workspaceSummary(): Promise<string>;
}

export interface WorkspaceGraphService {
  start(): Promise<void>;
  stop(): Promise<void>;
  reindexAll(): Promise<void>;
  query: WorkspaceGraphQueryApi;
  manifest: WorkspaceManifestApi;
}