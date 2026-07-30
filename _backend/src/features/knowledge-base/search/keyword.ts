import type { Database } from "bun:sqlite";
import type { SearchResult, SearchFilters } from "./types";

/**
 * Keyword search via FTS5.
 * FTS5 rank is BM25 score (higher = better match).
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
    const params: unknown[] = [ftsQuery];

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
        `SELECT c.id, c.document_id, d.filename, c.section, c.content, fts.rank
         FROM knowledge_fts fts
         JOIN knowledge_chunks c ON c.id = fts.chunk_id
         JOIN knowledge_documents d ON d.id = c.document_id
         WHERE fts.content MATCH ? ${whereSQL}
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(...params) as { id: string; document_id: string; filename: string; section: string; content: string; rank: number }[];

    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      filename: r.filename,
      section: r.section,
      content: r.content,
      score: r.rank,
      rank: r.rank,
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
  return terms.map((t) => `"${t}"*`).join(" ");
}
