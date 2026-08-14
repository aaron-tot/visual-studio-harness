import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { SearchResult, SearchFilters } from "./types";

/**
 * Keyword search via FTS5.
 * FTS5 rank is BM25 score (lower = better match). We convert to positive score (higher = better).
 */
export async function keywordSearch(
  db: Database,
  query: string,
  filters: SearchFilters | undefined,
  topK: number,
): Promise<SearchResult[]> {
  try {
    // Build FTS5 query with proper syntax
    const ftsQuery = buildFtsQuery(query);

    // Build filter WHERE clause
    // params order: [ftsQuery, ...filterParams, topK]
    // Filters are embedded BEFORE LIMIT ?, so push them between ftsQuery and topK
    const whereClauses: string[] = [];
    const params: SQLQueryBindings[] = [ftsQuery];

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

    // TopK comes last — after all filter params, because LIMIT ? is the final placeholder
    params.push(topK);

    const whereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(" AND ")}` : "";

    const rows = db
      .query(
        `SELECT c.id, c.document_id, d.filename, c.section, c.content, bm25(knowledge_fts) as bm25_score
         FROM knowledge_fts
         JOIN knowledge_chunks c ON c.id = knowledge_fts.chunk_id
         JOIN knowledge_documents d ON d.id = c.document_id
         WHERE knowledge_fts.content MATCH ? ${whereSQL}
         ORDER BY bm25_score ASC
         LIMIT ?`,
      )
      .all(...params) as { id: string; document_id: string; filename: string; section: string; content: string; bm25_score: number }[];

    // Convert BM25 to positive score: higher = better. BM25 is ~0 for best, so use 1/(1+bm25)
    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      filename: r.filename,
      section: r.section,
      content: r.content,
      score: 1 / (1 + r.bm25_score),
      rank: r.bm25_score,
    }));
  } catch (err: any) {
    console.warn("[knowledge] Keyword search unavailable:", err.message);
    return [];
  }
}

function buildFtsQuery(query: string): string {
  // Escape FTS5 special characters and build a proper query
  // Split into terms, prefix each with + for AND semantics
  const terms = query
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) return query;

  // Use prefix matching for partial completion
  // Bare tokens with * are valid FTS5 prefix syntax (e.g. "Timmy*").
  // Quoted phrases with * ("Timmy"*) are NOT valid FTS5 syntax.
  return terms.map((t) => `${t}*`).join(" ");
}
