import type { WorkspaceGraphRepository } from "../storage/repository";
import { eq, like, and, sql } from "drizzle-orm";
import * as schema from "../storage/schema";
import type {
  SymbolMatch,
  FileRecord,
  FolderRecord,
  ImportRecord,
  ExportRecord,
  WorkspaceSummary,
} from "../api/types";

export function createQueryApi(
  db: import("../storage/db").WorkspaceGraphDb,
  repo: WorkspaceGraphRepository
) {
  return {
    async findSymbol(name?: string, kind?: string): Promise<SymbolMatch[]> {
      const conditions: any[] = [];
      if (name) {
        conditions.push(like(schema.symbols.name, `%${name}%`));
      }
      if (kind) {
        const dbKind = kind === "type" ? "typeAlias" : kind;
        conditions.push(eq(schema.symbols.kind, dbKind as any));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(schema.symbols)
        .innerJoin(schema.files, eq(schema.symbols.fileId, schema.files.id))
        .where(whereClause)
        .limit(5000);

      return rows.map((r: any) => ({
        symbol: {
          id: r.symbols.id,
          name: r.symbols.name,
          kind: r.symbols.kind,
          fileId: r.symbols.fileId,
          exported: r.symbols.exported,
          async: r.symbols.async,
          static: r.symbols.static,
          visibility: r.symbols.visibility as any,
          signature: r.symbols.signature,
          startLine: r.symbols.startLine,
          endLine: r.symbols.endLine,
          structuralHash: r.symbols.structuralHash,
        },
        filePath: r.files.path,
        fileName: r.files.filename,
      }));
    },

    async findFunction(name: string): Promise<SymbolMatch[]> {
      return this.findSymbol(name, "function");
    },

    async findClass(name: string): Promise<SymbolMatch[]> {
      return this.findSymbol(name, "class");
    },

    async findInterface(name: string): Promise<SymbolMatch[]> {
      return this.findSymbol(name, "interface");
    },

    async listImports(filePath: string): Promise<ImportRecord[]> {
      const rows = await db
        .select()
        .from(schema.imports)
        .innerJoin(schema.files, eq(schema.imports.fileId, schema.files.id))
        .where(eq(schema.files.path, filePath));

      return rows.map((r: any) => ({
        module: r.imports.module,
        symbols: JSON.parse(r.imports.symbols || "[]"),
        importType: r.imports.importType as any,
        filePath: r.files.path,
      }));
    },

    async listExports(filePath: string): Promise<ExportRecord[]> {
      const rows = await db
        .select()
        .from(schema.exports_)
        .innerJoin(schema.files, eq(schema.exports_.fileId, schema.files.id))
        .where(eq(schema.files.path, filePath));

      return rows.map((r: any) => ({
        symbol: r.exports.symbol,
        isDefault: r.exports.isDefault,
        filePath: r.files.path,
      }));
    },

    async listFiles(folderPath?: string): Promise<FileRecord[]> {
      const q = db.select().from(schema.files);
      if (folderPath) {
        const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
        q.where(like(schema.files.path, prefix + "%"));
      }
      const rows = await q.limit(1000);
      return rows.map((r: any) => ({
        id: r.id,
        path: r.path,
        filename: r.filename,
        extension: r.extension,
        language: r.language,
        size: r.size,
        modifiedMs: r.modifiedMs,
        fileHash: r.fileHash,
        indexedAtMs: r.indexedAtMs,
      }));
    },

    async listFolders(parentPath?: string): Promise<FolderRecord[]> {
      const q = db.select().from(schema.folders);
      if (parentPath) {
        q.where(like(schema.folders.path, parentPath + "%"));
      }
      const rows = await q.limit(500);
      return rows.map((r: any) => ({
        id: r.id,
        path: r.path,
        parentId: r.parentId,
        name: r.path.split("/").pop() || r.path,
      }));
    },

    async workspaceSummary(): Promise<WorkspaceSummary> {
      const fileCountRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(schema.files)
        .then((r: any) => r[0]?.count || 0);

      const folderCountRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(schema.folders)
        .then((r: any) => r[0]?.count || 0);

      const symbolCountRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(schema.symbols)
        .then((r: any) => r[0]?.count || 0);

      const langRows = await db
        .select({ language: schema.files.language })
        .from(schema.files)
        .groupBy(schema.files.language)
        .limit(50);

      const languages = langRows.map((r: any) => r.language).filter(Boolean);

      const lastIndexed = await db
        .select({ indexedAtMs: schema.files.indexedAtMs })
        .from(schema.files)
        .orderBy(sql`indexed_at_ms DESC`)
        .limit(1)
        .then((r: any) => r[0]?.indexedAtMs || 0);

      return {
        fileCount: Number(fileCountRow),
        folderCount: Number(folderCountRow),
        symbolCount: Number(symbolCountRow),
        languages: languages,
        lastIndexedAt: Number(lastIndexed),
      };
    },
  };
}

export type QueryApi = ReturnType<typeof createQueryApi>;