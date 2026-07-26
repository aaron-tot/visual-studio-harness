import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type WorkspaceGraphDb = ReturnType<typeof drizzle<typeof schema>>;

const dbs = new Map<string, WorkspaceGraphDb>();

export function openWorkspaceGraphDb(dbPath: string): WorkspaceGraphDb {
  let db = dbs.get(dbPath);
  if (!db) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA synchronous = NORMAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    ensureWorkspaceGraphSchema(sqlite);
    db = drizzle(sqlite, { schema });
    dbs.set(dbPath, db);
  }
  return db;
}

export function closeWorkspaceGraphDb(dbPath: string): void {
  const db = dbs.get(dbPath);
  if (db) {
    dbs.delete(dbPath);
  }
}

function ensureWorkspaceGraphSchema(sqlite: Database): void {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS workspaces (
      root_path TEXT PRIMARY KEY,
      graph_version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      indexed_at_ms INTEGER NOT NULL
    );
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES folders(id)
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);`);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      extension TEXT NOT NULL,
      language TEXT NOT NULL,
      size INTEGER NOT NULL,
      modified_ms INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      indexed_at_ms INTEGER NOT NULL
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);`);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent_id INTEGER,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      exported INTEGER NOT NULL,
      async INTEGER NOT NULL,
      static INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      signature TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      structural_hash TEXT NOT NULL
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(name, kind);`);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      symbols TEXT NOT NULL,
      import_type TEXT NOT NULL,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_imports_file_id ON imports(file_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_imports_module ON imports(module);`);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      is_default INTEGER NOT NULL,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_exports_file_id ON exports(file_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_exports_symbol ON exports(symbol);`);
}