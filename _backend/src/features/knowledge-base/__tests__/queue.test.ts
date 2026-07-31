import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { openKnowledgeDb, closeAllKnowledgeDbs } from "../db";
import { EmbeddingQueue } from "../embedding/queue";
import { countPendingJobs } from "../jobs";
import { deleteDocument } from "../service-mutations";
import type { EmbeddingProvider } from "../embedding/provider";

const fakeProvider: EmbeddingProvider = {
  displayName: "fake",
  modelName: "jina-embeddings-v3",
  dimensions: 1024,
  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic 1024-dim vector per text so vector search stays usable in tests.
    return texts.map((t, i) => {
      const vec = new Array(1024).fill(0);
      vec[0] = 1;
      vec[1] = i;
      for (let c = 0; c < t.length; c++) vec[2 + (c % 1020)] += t.charCodeAt(c);
      return vec;
    });
  },
};

describe("EmbeddingQueue", () => {
  let tmpDir: string;

  const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");

  beforeAll(() => {
    tmpDir = join(tmpdir(), `kb-queue-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    closeAllKnowledgeDbs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("processes queued embed jobs and stores vectors in vec0", async () => {
    const kb = await openKnowledgeDb(tmpDir, "global", undefined, undefined, 1024);
    expect(kb).not.toBeNull();

    // Insert a source document + chunk so the job has a real target row.
    const docId = "queue-doc-0001";
    kb!.sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'queue.md', 'qhash', 10, datetime('now'), datetime('now'))`,
      [docId],
    );
    kb!.sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES ('chunk-1', ?, 'alpha', 'Doc', 0, ?, datetime('now'))`,
      [docId, hashOf("alpha")],
    );
    kb!.sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES ('chunk-2', ?, 'beta', 'Doc', 1, ?, datetime('now'))`,
      [docId, hashOf("beta")],
    );

    const queue = new EmbeddingQueue(fakeProvider, 2);
    await queue.enqueueBatch(tmpDir, "global", [
      { chunkId: "chunk-1", content: "alpha" },
      { chunkId: "chunk-2", content: "beta" },
    ]);

    expect(await countPendingJobs(kb!, "embed")).toBe(2);

    await queue.processPending(tmpDir, "global");

    // Jobs drained.
    expect(await countPendingJobs(kb!, "embed")).toBe(0);

    // Vectors stored in vec0.
    const rows = kb!.sqlite
      .query("SELECT chunk_id FROM knowledge_embeddings ORDER BY chunk_id")
      .all() as { chunk_id: string }[];
    expect(rows).toEqual([{ chunk_id: "chunk-1" }, { chunk_id: "chunk-2" }]);

    // Chunks marked as embedded.
    const chunks = kb!.sqlite
      .query("SELECT id, embedding_model FROM knowledge_chunks ORDER BY id")
      .all() as { id: string; embedding_model: string | null }[];
    expect(chunks.every((c) => c.embedding_model === "jina-embeddings-v3")).toBe(true);

    // Cache rows written with correct dimensions.
    const cache = kb!.sqlite
      .query("SELECT model, dimensions, chunk_hash FROM knowledge_embedding_cache")
      .all() as { model: string; dimensions: number; chunk_hash: string }[];
    expect(cache.length).toBe(2);
    expect(cache.every((c) => c.model === "jina-embeddings-v3" && c.dimensions === 1024)).toBe(true);

    // Meta rows written (drives the embeddings-status API).
    const meta = kb!.sqlite
      .query("SELECT model, dimensions, chunk_hash FROM knowledge_embedding_meta")
      .all() as { model: string; dimensions: number; chunk_hash: string }[];
    expect(meta.length).toBe(2);
    expect(meta.every((c) => c.model === "jina-embeddings-v3" && c.dimensions === 1024)).toBe(true);

    // Vectors are queryable via vec0 MATCH against the embedding column.
    const stored = kb!.sqlite
      .query("SELECT embedding FROM knowledge_embeddings WHERE chunk_id = ?")
      .get("chunk-1") as { embedding: string };
    const match = kb!.sqlite
      .query("SELECT chunk_id, distance FROM knowledge_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?")
      .all(stored.embedding, 5) as { chunk_id: string; distance: number }[];
    expect(match.length).toBe(2);
    expect(match[0].chunk_id).toBe("chunk-1");
    expect(match[0].distance).toBe(0);
  });

  it("does not duplicate cache/meta rows when identical content is re-embedded", async () => {
    const kb = await openKnowledgeDb(tmpDir, "global", undefined, undefined, 1024);

    const docId = "queue-doc-0003";
    kb!.sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'dup.md', 'dhash', 10, datetime('now'), datetime('now'))`,
      [docId],
    );
    kb!.sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES ('chunk-4', ?, 'alpha', 'Doc', 0, ?, datetime('now'))`,
      [docId, hashOf("alpha")],
    );

    const queue = new EmbeddingQueue(fakeProvider, 2);
    // First embed of chunk-1 already populated cache/meta for hash of "alpha".
    // chunk-4 has the same content hash — re-processing must not create duplicate rows.
    await queue.enqueueBatch(tmpDir, "global", [{ chunkId: "chunk-4", content: "alpha" }]);
    await queue.processPending(tmpDir, "global");

    const cacheCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embedding_cache").get() as { c: number }).c;
    const metaCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embedding_meta").get() as { c: number }).c;
    expect(cacheCount).toBe(2);
    expect(metaCount).toBe(2);

    const vecCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embeddings").get() as { c: number }).c;
    expect(vecCount).toBe(3); // chunk-1, chunk-2 from prior test + chunk-4
  });

  it("removes embeddings when a document is deleted", async () => {
    const kb = await openKnowledgeDb(tmpDir, "global", undefined, undefined, 1024);

    const doc = await deleteDocument(tmpDir, "global", "queue-doc-0001", true);
    expect(doc.ok).toBe(true);

    const vecCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embeddings").get() as { c: number }).c;
    const cacheCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embedding_cache").get() as { c: number }).c;
    const metaCount = (kb!.sqlite.query("SELECT count(*) c FROM knowledge_embedding_meta").get() as { c: number }).c;
    // chunk-1/chunk-2 vectors removed by chunk_id; chunk-4 (doc-0003) vector remains.
    expect(vecCount).toBe(1);
    // Cache/meta are content-hash-keyed: h1 ("alpha", shared by chunk-4) and h2 both removed.
    expect(cacheCount).toBe(0);
    expect(metaCount).toBe(0);
  });

  it("throws when pending embed jobs exist but no provider is configured", async () => {
    const kb = await openKnowledgeDb(tmpDir, "global", undefined, undefined, 1024);
    expect(kb).not.toBeNull();

    const docId = "queue-doc-0004";
    kb!.sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'noprov.md', 'nhash', 10, datetime('now'), datetime('now'))`,
      [docId],
    );
    kb!.sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES ('chunk-5', ?, 'delta', 'Doc', 0, ?, datetime('now'))`,
      [docId, hashOf("delta")],
    );

    // Seed a queued embed job directly (enqueueBatch skips when provider is null).
    const queue = new EmbeddingQueue(null, 10);
    kb!.sqlite.run(
      `INSERT INTO knowledge_jobs (id, type, status, scope, payload, created_at, updated_at)
       VALUES (?, 'embed', 'queued', 'global', ?, datetime('now'), datetime('now'))`,
      ["job-noprov", JSON.stringify({ chunkId: "chunk-5", content: "delta" })],
    );

    await expect(queue.processPending(tmpDir, "global")).rejects.toThrow(/no embedding provider is available/);

    // Leave no pending jobs behind for tests sharing the same DB.
    kb!.sqlite.run(`DELETE FROM knowledge_jobs WHERE id='job-noprov'`);
  });

  it("marks jobs failed after retries are exhausted", async () => {
    const kb = await openKnowledgeDb(tmpDir, "global", undefined, undefined, 1024);
    expect(kb).not.toBeNull();

    const docId = "queue-doc-0002";
    kb!.sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'fail.md', 'fhash', 10, datetime('now'), datetime('now'))`,
      [docId],
    );
    kb!.sqlite.run(
      `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
       VALUES ('chunk-3', ?, 'gamma', 'Doc', 0, ?, datetime('now'))`,
      [docId, hashOf("gamma")],
    );

    const failing: EmbeddingProvider = {
      ...fakeProvider,
      async embed(): Promise<number[][]> {
        throw new Error("api down");
      },
    };

    const queue = new EmbeddingQueue(failing, 10);
    await queue.enqueueBatch(tmpDir, "global", [{ chunkId: "chunk-3", content: "gamma" }]);

    // Retry until exhausted (EMBEDDING_RETRIES = 3).
    for (let i = 0; i < 5; i++) {
      await queue.processPending(tmpDir, "global");
    }

    const jobs = kb!.sqlite
      .query("SELECT status, retry_count FROM knowledge_jobs WHERE type='embed' AND status='failed'")
      .all() as { status: string; retry_count: number }[];
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].retry_count).toBe(3);
  });
});
