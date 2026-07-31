import type { Database } from "bun:sqlite";

/**
 * Known embedding model dimensions for common models.
 * Used to dimension the vec0 table at creation time.
 */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "jina-embeddings-v3": 1024,
  "nomic-embed-text": 768,
  "all-MiniLM-L6-v2": 384,
  "gte-small": 384,
  "gte-base": 768,
  "gte-large": 1024,
};

// Default dimension for unknown models
const DEFAULT_DIMENSION = 768;

/**
 * Resolve the embedding dimension for a given model name.
 */
export function resolveDimension(modelName: string): number {
  return EMBEDDING_DIMENSIONS[modelName] || DEFAULT_DIMENSION;
}

/**
 * Create the vec0 virtual table for knowledge embeddings.
 * Requires the sqlite-vec extension to be loaded at runtime.
 * If vec0 is not available, logs a warning — vector search falls
 * back to keyword-only mode.
 *
 * The dimension is determined at DB creation time based on the
 * configured embedding model. If the model changes later, the
 * vec0 table must be dropped and recreated (which requires
 * re-indexing all documents).
 */
export function ensureVecTable(sqlite: Database, dimension: number = DEFAULT_DIMENSION): void {
  try {
    sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${dimension}]
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

/**
 * Remove embeddings for a document's chunks from vec0, cache, and meta.
 * vec0 is a virtual table so it has no FK cascade — cleanup is manual.
 */
export function deleteDocumentEmbeddings(
  sqlite: Database,
  chunkIds: string[],
  chunkHashes: string[],
): void {
  if (chunkIds.length === 0) return;

  const idIn = chunkIds.map(() => "?").join(",");
  const hashIn = chunkHashes.map(() => "?").join(",");

  try {
    sqlite.run(`DELETE FROM knowledge_embeddings WHERE chunk_id IN (${idIn})`, ...chunkIds);
  } catch (err: any) {
    console.warn("[knowledge] Failed to delete vectors:", err.message);
  }

  if (chunkHashes.length > 0) {
    try {
      sqlite.run(`DELETE FROM knowledge_embedding_cache WHERE chunk_hash IN (${hashIn})`, ...chunkHashes);
    } catch (err: any) {
      console.warn("[knowledge] Failed to delete embedding cache:", err.message);
    }
    try {
      sqlite.run(`DELETE FROM knowledge_embedding_meta WHERE chunk_hash IN (${hashIn})`, ...chunkHashes);
    } catch (err: any) {
      console.warn("[knowledge] Failed to delete embedding meta:", err.message);
    }
  }
}
