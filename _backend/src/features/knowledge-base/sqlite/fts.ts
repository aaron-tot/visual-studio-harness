import type { Database } from "bun:sqlite";
import { FTS5_TOKENIZER } from "../constants";

/**
 * Create the FTS5 virtual table for full-text search on knowledge chunks.
 * Uses `porter unicode61` tokenizer by default.
 */
export function ensureFtsTable(sqlite: Database): void {
  sqlite.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      chunk_id UNINDEXED,
      document_id UNINDEXED,
      section,
      content,
      tokenize='${FTS5_TOKENIZER}'
    );
  `);

  // Sync trigger: when a chunk is inserted, insert into FTS
  sqlite.run(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_chunks
    BEGIN
      INSERT INTO knowledge_fts(chunk_id, document_id, section, content)
      VALUES (new.id, new.document_id, new.section, new.content);
    END;
  `);

  // Sync trigger: when a chunk is updated, update FTS
  sqlite.run(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE OF content, section ON knowledge_chunks
    BEGIN
      UPDATE knowledge_fts SET section = new.section, content = new.content
      WHERE chunk_id = new.id;
    END;
  `);

  // Sync trigger: when a chunk is deleted, delete from FTS
  sqlite.run(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_chunks
    BEGIN
      DELETE FROM knowledge_fts WHERE chunk_id = old.id;
    END;
  `);
}

/**
 * Drop FTS5 table (for re-indexing).
 */
export function dropFtsTable(sqlite: Database): void {
  sqlite.run("DROP TABLE IF EXISTS knowledge_fts");
}
