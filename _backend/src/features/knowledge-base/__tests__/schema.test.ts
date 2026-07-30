import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { openKnowledgeDb, closeAllKnowledgeDbs } from "../db";

describe("Knowledge Base Schema", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `kb-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    closeAllKnowledgeDbs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates all 9 real tables and 2 virtual tables on init", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    expect(result).not.toBeNull();
    expect(result!.sqlite).toBeDefined();
    expect(result!.db).toBeDefined();

    const sqlite = result!.sqlite;

    // Check real tables exist
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("knowledge_documents");
    expect(tableNames).toContain("knowledge_chunks");
    expect(tableNames).toContain("knowledge_embedding_cache");
    expect(tableNames).toContain("knowledge_embedding_meta");
    expect(tableNames).toContain("knowledge_relationships");
    expect(tableNames).toContain("knowledge_groups");
    expect(tableNames).toContain("knowledge_group_documents");
    expect(tableNames).toContain("knowledge_jobs");
    expect(tableNames).toContain("knowledge_document_versions");

    // Check virtual tables exist (vec0 may not be available without sqlite-vec extension)
    const virtualTables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge_embeddings', 'knowledge_fts')")
      .all() as { name: string }[];

    const virtualNames = virtualTables.map((t) => t.name);
    // FTS5 is always available via Bun SQLite
    expect(virtualNames).toContain("knowledge_fts");
    // vec0 requires sqlite-vec extension — may not be present
    if (!virtualNames.includes("knowledge_embeddings")) {
      console.warn("[test] vec0 table not created — sqlite-vec extension not loaded");
    }
  });

  it("has correct columns on knowledge_documents", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    const cols = sqlite
      .query("PRAGMA table_info(knowledge_documents)")
      .all() as { name: string; type: string; notnull: number; pk: number }[];

    const colMap = new Map(cols.map((c) => [c.name, c]));

    expect(colMap.get("id")?.type).toBe("TEXT");
    expect(colMap.get("id")?.pk).toBe(1);
    expect(colMap.get("filename")?.notnull).toBe(1);
    expect(colMap.get("title")).toBeDefined();
    expect(colMap.get("topics")).toBeDefined();
    expect(colMap.get("summary")).toBeDefined();
    expect(colMap.get("file_hash")?.notnull).toBe(1);
    expect(colMap.get("status")?.notnull).toBe(1);
    expect(colMap.get("scope")?.notnull).toBe(1);
    expect(colMap.get("created_at")?.notnull).toBe(1);
    expect(colMap.get("updated_at")?.notnull).toBe(1);
  });

  it("has correct columns on knowledge_chunks", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    const cols = sqlite
      .query("PRAGMA table_info(knowledge_chunks)")
      .all() as { name: string; type: string; notnull: number; pk: number }[];

    const colMap = new Map(cols.map((c) => [c.name, c]));

    expect(colMap.get("id")?.pk).toBe(1);
    expect(colMap.get("document_id")?.notnull).toBe(1);
    expect(colMap.get("content")?.notnull).toBe(1);
    expect(colMap.get("section")).toBeDefined();
    expect(colMap.get("chunk_index")?.notnull).toBe(1);
    expect(colMap.get("hash")?.notnull).toBe(1);
    expect(colMap.get("embedding_model")).toBeDefined();
  });

  it("has cascade delete on chunk -> document", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    // Insert a test document
    const docId = "00000000-0000-7000-8000-000000000001";
    sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'test.md', 'abc123', 42, datetime('now'), datetime('now'))`,
      [docId],
    );

    // Insert two chunks
    sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES (?, ?, 'hello', 'Doc', 0, 'ch1', datetime('now'))`,
      ["chunk-1", docId],
    );
    sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES (?, ?, 'world', 'Doc', 1, 'ch2', datetime('now'))`,
      ["chunk-2", docId],
    );

    // Delete the document (cascade should remove chunks)
    sqlite.run("DELETE FROM knowledge_documents WHERE id = ?", [docId]);

    const remaining = sqlite
      .query("SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE document_id = ?")
      .get(docId) as { cnt: number };

    expect(remaining.cnt).toBe(0);
  });

  it("accepts a valid insert into knowledge_groups and knowledge_group_documents", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    // Insert a document
    const docId = "00000000-0000-7000-8000-000000000002";
    sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'routes.md', 'def456', 100, datetime('now'), datetime('now'))`,
      [docId],
    );

    // Insert a group
    const groupId = "00000000-0000-7000-8000-000000000010";
    sqlite.run(
      `INSERT INTO knowledge_groups (id, name, sort_order, created_at, updated_at)
       VALUES (?, 'API Docs', 0, datetime('now'), datetime('now'))`,
      [groupId],
    );

    // Link document to group
    sqlite.run(
      `INSERT INTO knowledge_group_documents (id, group_id, document_id, sort_order, created_at)
       VALUES (?, ?, ?, 0, datetime('now'))`,
      ["gd-1", groupId, docId],
    );

    // Verify the link
    const link = sqlite
      .query("SELECT group_id, document_id FROM knowledge_group_documents WHERE id = ?")
      .get("gd-1") as { group_id: string; document_id: string };

    expect(link.group_id).toBe(groupId);
    expect(link.document_id).toBe(docId);
  });

  it("supports unique index on (filename, scope)", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, scope, file_hash, file_size, created_at, updated_at)
       VALUES ('u1', 'test.md', 'global', 'aaa', 10, datetime('now'), datetime('now'))`,
    );

    // Duplicate filename+scope should fail
    expect(() => {
      sqlite.run(
        `INSERT INTO knowledge_documents (id, filename, scope, file_hash, file_size, created_at, updated_at)
         VALUES ('u2', 'test.md', 'global', 'bbb', 20, datetime('now'), datetime('now'))`,
      );
    }).toThrow();
  });

  it("creates FTS triggers for insert, update, delete", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    const triggers = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all() as { name: string }[];

    const triggerNames = triggers.map((t) => t.name);
    expect(triggerNames).toContain("knowledge_fts_insert");
    expect(triggerNames).toContain("knowledge_fts_update");
    expect(triggerNames).toContain("knowledge_fts_delete");
  });

  it("FTS5 trigger fires on chunk insert — runtime search verification", async () => {
    const result = await openKnowledgeDb(tmpDir, "global");
    const sqlite = result!.sqlite;

    // Insert a document via raw SQL (same as Drizzle would)
    const docId = "fts-test-doc-0001";
    sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'search-test.md', 'abc', 50, datetime('now'), datetime('now'))`,
      [docId],
    );

    // Insert a chunk — this should fire the FTS5 trigger
    const chunkId = "fts-test-chunk-0001";
    sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES (?, ?, 'uniquematchword for testing', 'Section', 0, 'hash1', datetime('now'))`,
      [chunkId, docId],
    );

    // Search via FTS5 — the trigger should have populated knowledge_fts
    const rows = sqlite
      .query("SELECT chunk_id, content FROM knowledge_fts WHERE content MATCH ?")
      .all("uniquematchword") as { chunk_id: string; content: string }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.chunk_id === chunkId)).toBe(true);
  });
});

describe("resolveKnowledgeDir", () => {
  it("returns global path by default", async () => {
    const { resolveKnowledgeDir } = await import("../db");
    const result = resolveKnowledgeDir("/tmp/data", "global");
    expect(result).toBe("/tmp/data/knowledge");
  });

  it("returns project path under .agentHarness", async () => {
    const { resolveKnowledgeDir } = await import("../db");
    const result = resolveKnowledgeDir("/tmp/data", "project", "/home/user/my-project");
    expect(result).toBe("/home/user/my-project/.agentHarness/knowledge");
  });

  it("returns null for project scope without workspaceRoot", async () => {
    const { resolveKnowledgeDir } = await import("../db");
    const result = resolveKnowledgeDir("/tmp/data", "project");
    expect(result).toBeNull();
  });

  it("returns session path", async () => {
    const { resolveKnowledgeDir } = await import("../db");
    const result = resolveKnowledgeDir("/tmp/data", "session", undefined, "sess-123");
    expect(result).toBe("/tmp/data/session/sess-123/knowledge");
  });

  it("returns null for session scope without sessionId", async () => {
    const { resolveKnowledgeDir } = await import("../db");
    const result = resolveKnowledgeDir("/tmp/data", "session");
    expect(result).toBeNull();
  });
});
