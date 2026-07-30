import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUIDv7 } from "bun";
import { openKnowledgeDb, closeAllKnowledgeDbs, resolveKnowledgeDir } from "../db";
import { searchKnowledge } from "../search";
import { createDocument } from "../service-mutations";
import type { KnowledgeBaseConfig } from "../../../../../_shared/types/config";

const DATA_DIR = mkdtempSync(join(tmpdir(), "kb-e2e-"));
const CONFIG: KnowledgeBaseConfig = {
  enabled: true,
  sourcesPath: "knowledge/sources",
  dbPath: "knowledge/knowledge.db",
  chunkSize: 1024,
  chunkOverlap: 200,
  maxEmbeddingBatch: 50,
  maxTokens: 8192,
  embedding: { providerId: "none", model: "none", batchSize: 50 },
  search: { vectorWeight: 0.6, keywordWeight: 0.3, metadataWeight: 0.1, topK: 10, reranking: false },
};

/**
 * End-to-end test that exactly replicates the knowledge_search tool flow:
 * 1. Create a document via createDocument (same path as the tool)
 * 2. Search via searchKnowledge (same path as the tool)
 * 3. Verify results
 */
describe("knowledge_search end-to-end (replicates tool flow)", () => {
  beforeAll(async () => {
    mkdirSync(join(DATA_DIR, "knowledge", "sources"), { recursive: true });
  });

  afterAll(() => {
    closeAllKnowledgeDbs();
    try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  });

  it("1. createDocument inserts chunks and FTS5 triggers fire", async () => {
    const doc = await createDocument(DATA_DIR, "global", {
      filename: "e2e-test.md",
      content: "# End-to-End Test\n\nThis document is created exactly like the knowledge_document_create tool does.\nIt contains unique search terms like XylophoneZebra42.",
      tags: ["test"],
      createdBy: "agent",
    });

    expect(doc.id).toBeTruthy();
    expect(doc.filename).toBe("e2e-test.md");
    expect(doc.status).toBe("ready");
  });

  it("2. searchKnowledge finds exact term (same scope)", async () => {
    const { results, hybrid } = await searchKnowledge(
      DATA_DIR,
      "global",
      "XylophoneZebra42",
      { limit: 10 },
      CONFIG,
      [],
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "e2e-test.md")).toBe(true);
    expect(hybrid).toBe(false); // no vector provider, so keyword-only
  });

  it("3. searchKnowledge finds content by partial word", async () => {
    const { results } = await searchKnowledge(
      DATA_DIR,
      "global",
      "Xylophone",
      { limit: 10 },
      CONFIG,
      [],
    );

    expect(results.length).toBeGreaterThan(0);
  });

  it("4. searchKnowledge returns empty for non-matching query", async () => {
    const { results } = await searchKnowledge(
      DATA_DIR,
      "global",
      "NonExistentTermXYZ",
      { limit: 10 },
      CONFIG,
      [],
    );

    expect(results).toEqual([]);
  });

  it("5. searchKnowledge in project scope returns empty when no workspaceRoot", async () => {
    const { results } = await searchKnowledge(
      DATA_DIR,
      "project",
      "XylophoneZebra42",
      { limit: 10 },
      CONFIG,
      [],
    );

    // Without workspaceRoot, project scope cannot resolve dir → returns empty
    expect(results).toEqual([]);
  });

  it("6. searchKnowledge in project scope works with workspaceRoot", async () => {
    // Create a workspace dir
    const workspaceRoot = join(DATA_DIR, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const doc = await createDocument(DATA_DIR, "project", {
      filename: "project-test.md",
      content: "Project-specific content with unique term ProjectZebra99.",
      tags: [],
      createdBy: "agent",
    }, workspaceRoot);

    expect(doc.id).toBeTruthy();

    const { results } = await searchKnowledge(
      DATA_DIR,
      "project",
      "ProjectZebra99",
      { limit: 10 },
      CONFIG,
      [],
      workspaceRoot,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "project-test.md")).toBe(true);
  });

  it("7. searchKnowledge in session scope works with sessionId", async () => {
    const sessionId = randomUUIDv7();

    const doc = await createDocument(DATA_DIR, "session", {
      filename: "session-test.md",
      content: "Session-specific content with unique term SessionZebra77.",
      tags: [],
      createdBy: "agent",
    }, undefined, sessionId);

    expect(doc.id).toBeTruthy();

    const { results } = await searchKnowledge(
      DATA_DIR,
      "session",
      "SessionZebra77",
      { limit: 10 },
      CONFIG,
      [],
      undefined,
      sessionId,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filename === "session-test.md")).toBe(true);
  });

  it("8. searchKnowledge in session scope returns empty when no sessionId", async () => {
    const { results } = await searchKnowledge(
      DATA_DIR,
      "session",
      "SessionZebra77",
      { limit: 10 },
      CONFIG,
      [],
    );

    // Without sessionId, session scope cannot resolve dir → returns empty
    expect(results).toEqual([]);
  });

  it("9. Multiple docs in global scope — search finds correct one", async () => {
    await createDocument(DATA_DIR, "global", {
      filename: "alpha.md",
      content: "Alpha document with term AlphaSearch42.",
      tags: [],
      createdBy: "agent",
    });
    await createDocument(DATA_DIR, "global", {
      filename: "beta.md",
      content: "Beta document with term BetaSearch99.",
      tags: [],
      createdBy: "agent",
    });

    const { results: alphaResults } = await searchKnowledge(
      DATA_DIR,
      "global",
      "AlphaSearch42",
      { limit: 10 },
      CONFIG,
      [],
    );
    expect(alphaResults.length).toBeGreaterThan(0);
    expect(alphaResults.some((r) => r.filename === "alpha.md")).toBe(true);

    const { results: betaResults } = await searchKnowledge(
      DATA_DIR,
      "global",
      "BetaSearch99",
      { limit: 10 },
      CONFIG,
      [],
    );
    expect(betaResults.length).toBeGreaterThan(0);
    expect(betaResults.some((r) => r.filename === "beta.md")).toBe(true);
  });

  it("10. Different modes still return results", async () => {
    for (const mode of ["general", "code", "research", "documentation"] as const) {
      const { results } = await searchKnowledge(
        DATA_DIR,
        "global",
        "XylophoneZebra42",
        { limit: 10, mode },
        CONFIG,
        [],
      );
      expect(results.length).toBeGreaterThan(0, `mode=${mode} should return results`);
    }
  });
});
