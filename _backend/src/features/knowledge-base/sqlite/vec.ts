import type { Database } from "bun:sqlite";

/**
 * Create the vec0 virtual table for knowledge embeddings.
 * Requires the sqlite-vec extension to be loaded at runtime.
 * If vec0 is not available, logs a warning — vector search falls
 * back to keyword-only mode.
 */
export function ensureVecTable(sqlite: Database): void {
  try {
    sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[1536]
      );
    `);
  } catch (err: any) {
    console.warn("[knowledge] vec0 extension not available — vector search disabled:", err?.message);
  }
}

/**
 * Drop vec0 table (for re-indexing).
 */
export function dropVecTable(sqlite: Database): void {
  try {
    sqlite.run("DROP TABLE IF EXISTS knowledge_embeddings");
  } catch {
    // table may not exist
  }
}
