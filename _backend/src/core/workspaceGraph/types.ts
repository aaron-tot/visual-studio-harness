export interface WorkspaceGraphServiceInput {
  workspaceRoot: string;
  enableWatcher?: boolean;
  debounceMs?: number;
}

export interface WorkspaceGraphConfig {
  workspaceRoot: string;
  dbPath: string;
  enableWatcher: boolean;
  debounceMs: number;
  includeExtensions: string[];
  excludeDirs: string[];
}

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "enum"
  | "namespace"
  | "typeAlias"
  | "variable"
  | "constant";

export interface SymbolRow {
  id?: number;
  name: string;
  kind: SymbolKind;
  parentId: number | null;
  fileId: number;
  exported: boolean;
  async: boolean;
  static: boolean;
  visibility: "public" | "private" | "protected";
  signature: string | null;
  startLine: number;
  endLine: number;
  structuralHash: string;
}

export interface FileRow {
  id?: number;
  path: string;
  filename: string;
  extension: string;
  language: string;
  size: number;
  modifiedMs: number;
  fileHash: string;
  indexedAtMs: number;
}

export interface FolderRow {
  id?: number;
  path: string;
  parentId: number | null;
}

export interface WorkspaceRow {
  rootPath: string;
  graphVersion: number;
  createdAtMs: number;
  updatedAtMs: number;
  indexedAtMs: number;
}

export interface ImportRow {
  module: string;
  symbols: string[];
  importType: "default" | "named" | "namespace" | "sideEffect";
  fileId: number;
}

export interface ExportRow {
  symbol: string;
  isDefault: boolean;
  fileId: number;
}

export interface RelationshipRow {
  callerId: number;
  calleeId: number;
  type: "calls" | "extends" | "implements";
}

export interface ScannedFile {
  path: string;
  filename: string;
  extension: string;
  language: string;
  size: number;
  modifiedMs: number;
  fileHash: string;
  sourceText: string;
}

export interface ScanResult {
  created: ScannedFile[];
  modified: ScannedFile[];
  deleted: { path: string; fileHash: string; modifiedMs: number }[];
  unchanged: { path: string; fileHash: string; modifiedMs: number }[];
}

export interface ScanInput {
  workspaceRoot: string;
  existingIndex: { path: string; fileHash: string; modifiedMs: number }[];
  includeExtensions?: string[];
  excludeDirs?: string[];
}