import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import * as schema from "./schema";
import { ensureVecTable } from "./sqlite/vec";
import { ensureFtsTable } from "./sqlite/fts";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export interface KnowledgeScopeDb {
  path: string;
  sqlite: Database;
  db: DrizzleDb;
}

const scopeDbs = new Map<string, KnowledgeScopeDb>();

export type KbScope = "global" | "project" | "session";

export function resolveKnowledgeDir(
  dataDir: string,
  scope: KbScope,
  workspaceRoot?: string,
  sessionId?: string,
): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return join(resolve(workspaceRoot), ".agentHarness", "knowledge");
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "knowledge");
    default:
      return join(dataDir, "knowledge");
  }
}

/**
 * Initialize all tables (real + vec0 + FTS5) in a SQLite file.
 * Real tables are created via raw SQL (matching the existing pattern
 * in _backend/src/db/client.ts). Drizzle ORM is used only for queries,
 * not for schema management.
 */
function initSchema(sqlite: Database, embeddingDimension?: number): void {
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  // ── knowledge_documents ──────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      topics TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'text',
      file_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      created_by TEXT NOT NULL DEFAULT 'user',
      scope TEXT NOT NULL DEFAULT 'global',
      tags TEXT NOT NULL DEFAULT '[]',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_filename_scope
    ON knowledge_documents(filename, scope)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_docs_status ON knowledge_documents(status)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_docs_scope ON knowledge_documents(scope)
  `);

  // ── knowledge_chunks ─────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'Document',
      chunk_index INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL,
      embedding_model TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON knowledge_chunks(document_id)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_chunks_hash ON knowledge_chunks(hash)
  `);

  // ── knowledge_embedding_cache ────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_embedding_cache (
      id TEXT PRIMARY KEY,
      chunk_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_hash_model
    ON knowledge_embedding_cache(chunk_hash, model)
  `);

  // ── knowledge_embedding_meta ─────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_embedding_meta (
      id TEXT PRIMARY KEY,
      chunk_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // ── knowledge_relationships ──────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_relationships (
      id TEXT PRIMARY KEY,
      source_document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      target_document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT 'related',
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_rels_source ON knowledge_relationships(source_document_id)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_rels_target ON knowledge_relationships(target_document_id)
  `);

  // ── knowledge_groups ─────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT 'global',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_groups_scope_sort
    ON knowledge_groups(scope, sort_order)
  `);

  // ── knowledge_group_documents (junction) ─────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_group_documents (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES knowledge_groups(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_doc_uq
    ON knowledge_group_documents(group_id, document_id)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_group_docs_group ON knowledge_group_documents(group_id)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_group_docs_document ON knowledge_group_documents(document_id)
  `);

  // ── knowledge_jobs ───────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      scope TEXT NOT NULL DEFAULT 'global',
      payload TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON knowledge_jobs(status)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON knowledge_jobs(type, status)
  `);

  // ── knowledge_document_versions ──────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS knowledge_document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_doc_version
    ON knowledge_document_versions(document_id, version_number)
  `);
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_versions_document ON knowledge_document_versions(document_id)
  `);

  // ── Virtual tables (vec0 + FTS5) ─────────────────────────────────
  ensureVecTable(sqlite, embeddingDimension);
  ensureFtsTable(sqlite);
}

/**
 * Open (or reuse) a knowledge DB for the given scope.
 */
export async function openKnowledgeDb(
  dataDir: string,
  scope: KbScope,
  workspaceRoot?: string,
  sessionId?: string,
  embeddingDimension?: number,
): Promise<KnowledgeScopeDb | null> {
  const dir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!dir) return null;

  const dbPath = join(dir, "knowledge.db");
  const cacheKey = dbPath;

  let existing = scopeDbs.get(cacheKey);
  if (existing) return existing;

  await mkdir(dir, { recursive: true });
  const sqlite = new Database(dbPath);

  initSchema(sqlite, embeddingDimension);

  const db = drizzle(sqlite, { schema });
  const entry: KnowledgeScopeDb = { path: dbPath, sqlite, db };
  scopeDbs.set(cacheKey, entry);
  return entry;
}

/**
 * Close a knowledge DB and remove from cache.
 */
export function closeKnowledgeDb(
  dataDir: string,
  scope: KbScope,
  workspaceRoot?: string,
  sessionId?: string,
): void {
  const dir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!dir) return;
  const dbPath = join(dir, "knowledge.db");
  const entry = scopeDbs.get(dbPath);
  if (entry) {
    entry.sqlite.close();
    scopeDbs.delete(dbPath);
  }
}

/**
 * Close all knowledge DBs (for service destroy).
 */
export function closeAllKnowledgeDbs(): void {
  for (const [, entry] of scopeDbs) {
    try {
      entry.sqlite.close();
    } catch {
      // already closed
    }
  }
  scopeDbs.clear();
}
