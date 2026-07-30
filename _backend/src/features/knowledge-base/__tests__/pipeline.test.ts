import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openKnowledgeDb, closeKnowledgeDb } from "../db";
import { runIngestion } from "../ingestion/pipeline";
import { knowledgeDocuments } from "../schema";
import { eq } from "drizzle-orm";

const DATA_DIR = mkdtempSync(join(tmpdir(), "kb-test-"));
const CONFIG = {
  enabled: true,
  sourcesPath: "knowledge/sources",
  dbPath: "knowledge/knowledge.db",
  embedding: { providerId: "none", model: "none", batchSize: 50 },
  search: { vectorWeight: 0.6, keywordWeight: 0.3, metadataWeight: 0.1, topK: 10, reranking: false },
};

describe("ingestion pipeline", () => {
  const sourcesDir = join(DATA_DIR, "knowledge", "sources");

  beforeAll(() => {
    mkdirSync(sourcesDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("indexes a new file", async () => {
    const filename = "test-doc.md";
    const content = "# Test Doc\n\nHello world.\n\n## Section\n\nMore content.";
    writeFileSync(join(sourcesDir, filename), content, "utf-8");

    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const result = await runIngestion(DATA_DIR, "global", kb, CONFIG);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([]);

    const doc = await kb.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.filename, filename))
      .get();
    expect(doc).toBeTruthy();
    expect(doc!.title).toBe("Test Doc");
    expect(doc!.chunkCount).toBe(2);
  });

  it("skips unchanged files (same hash)", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const result = await runIngestion(DATA_DIR, "global", kb, CONFIG);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("re-indexes when file content changes", async () => {
    const filename = "test-doc.md";
    const content = "# Test Doc\n\nUpdated content.";
    writeFileSync(join(sourcesDir, filename), content, "utf-8");

    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const result = await runIngestion(DATA_DIR, "global", kb, CONFIG);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);

    // Verify chunk count changed from 2 → 1
    const doc = await kb.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.filename, filename))
      .get();
    expect(doc!.chunkCount).toBe(1);
  });

  it("skips dotfiles and temp files", async () => {
    writeFileSync(join(sourcesDir, ".hidden"), "secret", "utf-8");
    writeFileSync(join(sourcesDir, "backup.swp"), "swap", "utf-8");
    writeFileSync(join(sourcesDir, "backup~"), "tilde", "utf-8");

    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const result = await runIngestion(DATA_DIR, "global", kb, CONFIG);
    // Should only process test-doc.md (already indexed)
    expect(result.updated).toBe(0);
  });

  it("reports errors for oversized files", async () => {
    const filename = "huge.md";
    const bigContent = "x".repeat(11 * 1024 * 1024); // 11 MB > 10 MB limit
    writeFileSync(join(sourcesDir, filename), bigContent, "utf-8");

    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    const result = await runIngestion(DATA_DIR, "global", kb, CONFIG);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failed[0].filename).toBe(filename);
  });

  it("returns empty result when sources dir does not exist", async () => {
    const kb = await openKnowledgeDb(DATA_DIR, "global");
    if (!kb) throw new Error("Failed to open DB");

    // Use a non-existent scope
    const result = await runIngestion("/nonexistent", "global", kb, CONFIG);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([]);
  });
});
