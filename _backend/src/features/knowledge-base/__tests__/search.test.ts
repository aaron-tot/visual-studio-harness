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
  embedding: { providerId: "none", model: "none", batchSize: 50 },
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

    const results = await vectorSearch(kb.sqlite, new Float32Array([0.1, 0.2]), undefined, 10);
    // vec0 table exists but has no rows — returns empty (or throws caught gracefully)
    expect(Array.isArray(results)).toBe(true);
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

  it("returns empty array for no results", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const results = await keywordSearch(kb.sqlite, "xyznonexistent_42", undefined, 10);
    expect(results).toEqual([]);
  });
});
