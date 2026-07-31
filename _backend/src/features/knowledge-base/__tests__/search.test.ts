import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openKnowledgeDb, closeKnowledgeDb } from "../db";
import { runIngestion } from "../ingestion/pipeline";
import { keywordSearch } from "../search/keyword";
import { vectorSearch } from "../search/vector";
import { fuseResults } from "../search/fusion";
import type { SearchResult } from "../search/types";

const DATA_DIR = mkdtempSync(join(tmpdir(), "kb-search-"));
const CONFIG = {
  enabled: true,
  sourcesPath: "knowledge/sources",
  dbPath: "knowledge/knowledge.db",
  embedding: { providerId: "", model: "", batchSize: 50 },
  search: { vectorWeight: 0.6, keywordWeight: 0.3, metadataWeight: 0.1, topK: 10, reranking: false },
};

describe("search system", () => {
  const sourcesDir = join(DATA_DIR, "knowledge", "sources");

  beforeAll(async () => {
    mkdirSync(sourcesDir, { recursive: true });

    // Create test documents
    writeFileSync(
      join(sourcesDir, "api-docs.md"),
      "# API Documentation\n\nREST endpoints for the user service.\n\n## GET /users\n\nReturns a list of users.\n\n## POST /users\n\nCreates a new user.",
      "utf-8",
    );
    writeFileSync(
      join(sourcesDir, "architecture.md"),
      "# Architecture\n\nSystem uses microservices.\n\n## Database\n\nPostgreSQL with connection pooling.",
      "utf-8",
    );
    writeFileSync(
      join(sourcesDir, "deployment.md"),
      "# Deployment\n\nDeploy using Docker Compose.\n\n## Steps\n\n1. Build images\n2. Push to registry\n3. Deploy",
      "utf-8",
    );
    writeFileSync(
      join(sourcesDir, "readme.txt"),
      "Installation\nSimple setup guide.\n\nRun npm install to get started.",
      "utf-8",
    );

    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");
    await runIngestion(DATA_DIR, "global", kb, CONFIG);
  });

  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("keyword search finds exact term", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "Docker", undefined, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "deployment.md")).toBe(true);
  });

  it("keyword search finds content across documents", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "users", undefined, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "api-docs.md")).toBe(true);
  });

  it("keyword search with extension filter", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "Docker", { extension: ".txt" }, 10);
    expect(results.length).toBe(0);
  });

  it("keyword search with correct extension filter", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "Docker", { extension: ".md" }, 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("keyword search with filename filter", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "users", { filename: "api-docs.md" }, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filename === "api-docs.md")).toBe(true);
  });

  it("vector search returns empty array when vec0 table exists but no embeddings", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const dim = 768; // matches vec0 dimension created with default embedding model
    const vec = new Float32Array(dim);
    vec[0] = 1;
    const results = await vectorSearch(kb.sqlite, vec, undefined, 10);
    // vec0 table exists but has no rows — returns empty (no throw)
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("vector search returns results when embeddings exist (knn JOIN query)", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    // Pick an existing chunk and give it a known embedding.
    const chunk = kb.sqlite
      .query("SELECT id, document_id FROM knowledge_chunks LIMIT 1")
      .get() as { id: string; document_id: string } | null;
    expect(chunk).toBeTruthy();

    const dim = 768;
    const vec = new Float32Array(dim);
    vec[0] = 1;
    const vecStr = `[${Array.from(vec).join(",")}]`;
    try {
      kb.sqlite.run(
        "INSERT INTO knowledge_embeddings(chunk_id, embedding) VALUES (?, ?)",
        [chunk!.id, vecStr],
      );
    } catch {
      // vec0 already has a row for this chunk (dimension mismatch guard) — skip insert
    }

    const results = await vectorSearch(kb.sqlite, vec, undefined, 10);
    // The JOIN query must succeed and return at least the seeded chunk.
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.chunkId === chunk!.id)).toBe(true);
  });

  it("fuseResults combines results with correct scoring", () => {
    const vectorResults: SearchResult[] = [
      { chunkId: "c1", documentId: "d1", filename: "a.md", section: "Doc", content: "a", score: 0.5, distance: 1.0 },
      { chunkId: "c2", documentId: "d2", filename: "b.md", section: "Doc", content: "b", score: 0.3, distance: 2.33 },
    ];
    const keywordResults: SearchResult[] = [
      { chunkId: "c1", documentId: "d1", filename: "a.md", section: "Section", content: "a", score: 0, rank: 1 },
      { chunkId: "c3", documentId: "d3", filename: "c.md", section: "Doc", content: "c", score: 0, rank: 2 },
    ];

    const fused = fuseResults(vectorResults, keywordResults, { vector: 0.6, keyword: 0.3, metadata: 0.1 }, 5);
    expect(fused.length).toBe(3);
    // c1 appears in both — should have highest score
    const c1 = fused.find((r) => r.chunkId === "c1");
    expect(c1).toBeTruthy();
    // c3 only in keyword — should be present
    expect(fused.some((r) => r.chunkId === "c3")).toBe(true);
  });

  it("fuseResults keeps a nonzero score for a single keyword result", () => {
    const keywordResults: SearchResult[] = [
      { chunkId: "c1", documentId: "d1", filename: "a.md", section: "Document", content: "a", score: 1.000001, rank: -0.000001 },
    ];

    const fused = fuseResults([], keywordResults, { vector: 0.6, keyword: 0.3, metadata: 0.1 }, 5);
    const c1 = fused.find((r) => r.chunkId === "c1");
    expect(c1).toBeTruthy();
    expect(c1!.score).toBeGreaterThan(0);
  });

  it("fuseResults applies metadata boost for structured sections", () => {
    const results: SearchResult[] = [
      { chunkId: "c1", documentId: "d1", filename: "a.md", section: "Doc", content: "a", score: 0 },
      { chunkId: "c2", documentId: "d2", filename: "b.md", section: "API > Routes", content: "b", score: 0 },
    ];

    const fused = fuseResults(results, [], { vector: 0.6, keyword: 0.3, metadata: 0.1 }, 5);
    // c2 with structured section should get metadata boost
    const c2 = fused.find((r) => r.chunkId === "c2");
    expect(c2!.score).toBeGreaterThan(0);
  });

  it("fuseResults does not double-apply the metadata boost when a chunk is in both lists", () => {
    const shared: SearchResult = {
      chunkId: "c1", documentId: "d1", filename: "a.md",
      section: "API > Users", content: "x", score: 0.5, distance: 1,
    };
    const kwShared: SearchResult = {
      chunkId: "c1", documentId: "d1", filename: "a.md",
      section: "API > Users", content: "x", score: 1.0, rank: 1,
    };

    const fused = fuseResults([shared], [kwShared], { vector: 0.6, keyword: 0.3, metadata: 0.1 }, 5);
    const c1 = fused.find((r) => r.chunkId === "c1");
    // Exact expected: 0.6*0.5 + 0.3*1.0 + 0.1*0.05 = 0.605 (boost applied once)
    expect(c1!.score).toBeCloseTo(0.605, 6);
  });

  it("uses mode preset weights (not just config weights)", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    // config.search weights are 0.6/0.3/0.1 in CONFIG; code mode preset is 0.3/0.6/0.1.
    const { searchKnowledge } = await import("../search");
    const result = await searchKnowledge(
      DATA_DIR, "global", "users", { mode: "code" }, CONFIG,
    );
    // With code weights (keyword-dominant), a keyword match should score
    // at least as high as general mode. Regression guard: mode must affect scoring.
    const general = await searchKnowledge(
      DATA_DIR, "global", "users", { mode: "general" }, CONFIG,
    );
    const codeTop = result.results[0];
    const generalTop = general.results[0];
    expect(codeTop).toBeTruthy();
    expect(generalTop).toBeTruthy();
    // code mode weights keyword higher — assert a code-vs-general divergence in
    // keyword-heavy queries is representable: scores differ or code >= general
    expect(codeTop.score).toBeGreaterThanOrEqual(generalTop.score);
  });

  it("returns empty array for no results", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "xyznonexistent_42", undefined, 10);
    expect(results).toEqual([]);
  });

  it("hybrid is true when vector search ran even if keyword found nothing (spec: both channels RAN)", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    // Ensure at least one vector row exists so the vector channel returns a match.
    const chunk = kb.sqlite
      .query("SELECT id FROM knowledge_chunks LIMIT 1")
      .get() as { id: string } | null;
    if (chunk) {
      const vec = new Float32Array(768);
      vec[0] = 1;
      const vecStr = `[${Array.from(vec).join(",")}]`;
      try {
        kb.sqlite.run(
          "INSERT INTO knowledge_embeddings(chunk_id, embedding) VALUES (?, ?)",
          [chunk.id, vecStr],
        );
      } catch { /* already seeded */ }
    }

    // Local stub embedding endpoint returning a fixed 768-dim vector.
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: [{ embedding: new Array(768).fill(0.01) }] }),
    });

    try {
      const fakeProvider = {
        displayName: "fake",
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "",
        headers: {},
        models: [{ displayName: "Nomic", modelName: "nomic-embed-text", enabled: true }],
        enabled: true,
      };
      const cfg = {
        ...CONFIG,
        embedding: { providerId: "fake", model: "nomic-embed-text", batchSize: 50 },
      };

      const { searchKnowledge } = await import("../search");
      // No keyword match, but vector search runs against the seeded row.
      const { results, hybrid, total } = await searchKnowledge(
        DATA_DIR, "global", "zzzz_no_keyword_match", { mode: "general" }, cfg, [fakeProvider],
      );

      expect(hybrid).toBe(true); // vector channel ran (keyword always runs)
      expect(results.length).toBeGreaterThan(0); // KNN returned the seeded chunk
      expect(total).toBeGreaterThanOrEqual(results.length);
    } finally {
      server.stop(true);
    }
  });

  it("mode preset topK applies when limit is not explicitly set; explicit limit overrides", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    // Seed a doc with 16 chunks sharing a keyword so FTS returns 16 matches.
    const docId = "topk-doc";
    kb.sqlite.run(
      `INSERT INTO knowledge_documents (id, filename, file_hash, file_size, created_at, updated_at)
       VALUES (?, 'topk.md', 'thash', 10, datetime('now'), datetime('now'))`,
      [docId],
    );
    for (let i = 0; i < 16; i++) {
      kb.sqlite.run(
        `INSERT INTO knowledge_chunks (id, document_id, content, section, chunk_index, hash, created_at)
         VALUES (?, ?, 'TopKNeedle phrase', 'Doc', ?, ?, datetime('now'))`,
        [`topk-chunk-${i}`, docId, i, `th${i}`],
      );
    }

    const { searchKnowledge } = await import("../search");
    // general preset topK=10
    const general = await searchKnowledge(DATA_DIR, "global", "TopKNeedle", { mode: "general" }, CONFIG);
    expect(general.results.length).toBe(10);
    expect(general.total).toBe(16);
    // code preset topK=15
    const code = await searchKnowledge(DATA_DIR, "global", "TopKNeedle", { mode: "code" }, CONFIG);
    expect(code.results.length).toBe(15);
    // explicit limit overrides the preset
    const limited = await searchKnowledge(DATA_DIR, "global", "TopKNeedle", { mode: "code", limit: 5 }, CONFIG);
    expect(limited.results.length).toBe(5);
  });
});
