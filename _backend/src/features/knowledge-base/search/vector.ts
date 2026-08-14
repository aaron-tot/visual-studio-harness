import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { SearchResult, SearchFilters } from "./types";

/**
 * Vector search via sqlite-vec.
 * Converts L2 distance to similarity: score = 1 / (1 + distance).
 * Throws when the vec0 table is missing or the query fails — the caller
 * surfaces the error instead of silently degrading to keyword-only results.
 */
export async function vectorSearch(
  db: Database,
  queryEmbedding: Float32Array,
  filters: SearchFilters | undefined,
  topK: number,
): Promise<SearchResult[]> {
  // Check if vec0 table exists
  const tableCheck = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_embeddings'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    throw new Error(
      "Vector table 'knowledge_embeddings' is missing — embeddings have not been initialized. Run knowledge_ingest first.",
    );
  }

  const embeddingStr = `[${Array.from(queryEmbedding).join(",")}]`;

  // Build filter WHERE clause
  const whereClauses: string[] = [];
  const params: SQLQueryBindings[] = [embeddingStr, topK];

  if (filters?.extension) {
    // Use LIKE on filename since there's no extension column
    whereClauses.push("d.filename LIKE ?");
    params.push(`%${filters.extension}`);
  }
  if (filters?.filename) {
    whereClauses.push("d.filename = ?");
    params.push(filters.filename);
  }
  if (filters?.createdAfter) {
    whereClauses.push("d.created_at >= ?");
    params.push(filters.createdAfter);
  }
  if (filters?.createdBefore) {
    whereClauses.push("d.created_at <= ?");
    params.push(filters.createdBefore);
  }
  if (filters?.createdBy) {
    whereClauses.push("d.created_by = ?");
    params.push(filters.createdBy);
  }

  const whereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT c.id, c.document_id, d.filename, c.section, c.content, vec.distance
       FROM knowledge_embeddings vec
       JOIN knowledge_chunks c ON c.id = vec.chunk_id
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE vec.embedding MATCH ? AND k = ? ${whereSQL}
       ORDER BY vec.distance`,
    )
    .all(...params) as { id: string; document_id: string; filename: string; section: string; content: string; distance: number }[];

  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.document_id,
    filename: r.filename,
    section: r.section,
    content: r.content,
    score: 1 / (1 + r.distance),
    distance: r.distance,
  }));
}
