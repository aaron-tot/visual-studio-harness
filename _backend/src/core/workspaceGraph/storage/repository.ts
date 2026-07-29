import { eq, and, inArray, sql } from "drizzle-orm";
import { WorkspaceGraphDb } from "./db";
import * as schema from "./schema";
import { folders, symbols, imports, exports_ } from "./schema";
import type { FolderRow, SymbolRow, ImportRow, ExportRow, WorkspaceRow, FileRow } from "../types";

export interface FileIndexRow {
  path: string;
  fileHash: string;
  modifiedMs: number;
}

export function createWorkspaceGraphRepository(db: WorkspaceGraphDb) {
  async function upsertWorkspace(meta: WorkspaceRow): Promise<void> {
    await db.insert(schema.workspaces).values(meta).onConflictDoUpdate({
      target: schema.workspaces.rootPath,
      set: {
        graphVersion: meta.graphVersion,
        updatedAtMs: meta.updatedAtMs,
        indexedAtMs: meta.indexedAtMs,
      },
    });
  }

  async function upsertFolders(rows: FolderRow[]): Promise<void> {
    for (const row of rows) {
      await db.insert(schema.folders).values(row).onConflictDoNothing();
    }
  }

  async function upsertFile(row: FileRow): Promise<number> {
    const existing = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.path, row.path))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.files)
        .set({
          filename: row.filename,
          extension: row.extension,
          language: row.language,
          size: row.size,
          modifiedMs: row.modifiedMs,
          fileHash: row.fileHash,
          indexedAtMs: row.indexedAtMs,
        })
        .where(eq(schema.files.path, row.path));
      return existing[0].id;
    }

    const inserted = await db
      .insert(schema.files)
      .values(row)
      .returning({ id: schema.files.id });
    return inserted[0].id;
  }

  async function replaceFileSymbols(fileId: number, rows: SymbolRow[]): Promise<void> {
    await db.delete(symbols).where(eq(symbols.fileId, fileId));
    if (rows.length > 0) {
      await db.insert(symbols).values(rows.map((r) => ({ ...r, fileId })));
    }
  }

  async function replaceFileImports(fileId: number, rows: ImportRow[]): Promise<void> {
    await db.delete(imports).where(eq(imports.fileId, fileId));
    if (rows.length > 0) {
      await db.insert(imports).values(rows.map((r) => ({ ...r, fileId })));
    }
  }

  async function replaceFileExports(fileId: number, rows: ExportRow[]): Promise<void> {
    await db.delete(exports_).where(eq(exports_.fileId, fileId));
    if (rows.length > 0) {
      await db.insert(exports_).values(rows.map((r) => ({ ...r, fileId })));
    }
  }

  async function deleteFileByPath(path: string): Promise<void> {
    await db.delete(schema.files).where(eq(schema.files.path, path));
  }

  async function listIndexedFiles(): Promise<FileIndexRow[]> {
    return db
      .select({
        path: schema.files.path,
        fileHash: schema.files.fileHash,
        modifiedMs: schema.files.modifiedMs,
      })
      .from(schema.files);
  }

  async function findFileByPath(path: string): Promise<{ id: number } | null> {
    const rows = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.path, path))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    upsertWorkspace,
    upsertFolders,
    upsertFile,
    replaceFileSymbols,
    replaceFileImports,
    replaceFileExports,
    deleteFileByPath,
    listIndexedFiles,
    findFileByPath,
  };
}

export type WorkspaceGraphRepository = ReturnType<typeof createWorkspaceGraphRepository>;
