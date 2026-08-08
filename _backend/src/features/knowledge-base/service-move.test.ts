import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createDocument } from "./service-mutations";
import { moveDocumentAcrossScopes } from "./service-move";
import { openKnowledgeDb, closeAllKnowledgeDbs } from "./db";
import { knowledgeDocuments, knowledgeChunks, knowledgeDocumentVersions, knowledgeRelationships } from "./schema";
import { eq, or } from "drizzle-orm";
import { MoveError } from "../../rest/scope-move";

const roots: string[] = [];

beforeAll(() => {
  closeAllKnowledgeDbs();
});

afterAll(async () => {
  closeAllKnowledgeDbs();
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe("moveDocumentAcrossScopes", () => {
  it("moves a document global→session preserving id, chunks, and file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    const doc = await createDocument(dataDir, "global", {
      filename: "a.md",
      content: "# A\n\nhello world this is a long enough chunk body",
      createdBy: "agent",
    });
    const r = await moveDocumentAcrossScopes({
      fromScope: "global",
      toScope: "session",
      documentId: doc.id,
      dataDir,
      sessionId: "s1",
    });
    expect(r.documentId).toBe(doc.id);

    const src = await openKnowledgeDb(dataDir, "global");
    const srcRow = src!.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id)).get();
    expect(srcRow).toBeUndefined();

    const dst = await openKnowledgeDb(dataDir, "session", undefined, "s1");
    const dstRow = dst!.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id)).get();
    expect(dstRow?.scope).toBe("session");
    expect(dstRow?.filepath).toBe(join(dataDir, "session", "s1", "knowledge", "sources", "a.md"));
    expect(existsSync(dstRow!.filepath)).toBe(true);

    const chunks = dst!.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.documentId, doc.id)).all();
    expect(chunks.length).toBeGreaterThan(0);

    const versions = dst!.db.select().from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.documentId, doc.id)).all();
    expect(versions.length).toBeGreaterThan(0);
    const fts = dst!.sqlite.query("SELECT count(*) AS c FROM knowledge_fts WHERE document_id = ?").get(doc.id) as { c: number };
    expect(fts.c).toBe(chunks.length);
    const srcChunks = src!.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.documentId, doc.id)).all();
    expect(srcChunks).toEqual([]);
  });

  it("throws MoveError(409) when target scope already has the filename", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    const doc = await createDocument(dataDir, "global", { filename: "b.md", content: "# B", createdBy: "agent" });
    await createDocument(dataDir, "session", { filename: "b.md", content: "# B", createdBy: "agent" }, undefined, "s1");
    try {
      await moveDocumentAcrossScopes({ fromScope: "global", toScope: "session", documentId: doc.id, dataDir, sessionId: "s1" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(409);
    }
  });

  it("skips relationships whose other endpoint is not in the target (FK-safe)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    const a = await createDocument(dataDir, "global", { filename: "c.md", content: "# C", createdBy: "agent" });
    const b = await createDocument(dataDir, "global", { filename: "d.md", content: "# D", createdBy: "agent" });
    const src = await openKnowledgeDb(dataDir, "global");
    await src!.db.insert(knowledgeRelationships).values({
      id: "rel-c-d",
      sourceDocumentId: a.id,
      targetDocumentId: b.id,
      relationType: "related",
      weight: 1,
      createdAt: new Date().toISOString(),
    });

    const r = await moveDocumentAcrossScopes({ fromScope: "global", toScope: "session", documentId: a.id, dataDir, sessionId: "s1" });
    expect(r.documentId).toBe(a.id);

    const dst = await openKnowledgeDb(dataDir, "session", undefined, "s1");
    const dstRels = dst!.db
      .select()
      .from(knowledgeRelationships)
      .where(
        or(
          eq(knowledgeRelationships.sourceDocumentId, a.id),
          eq(knowledgeRelationships.targetDocumentId, a.id),
        ),
      )
      .all();
    expect(dstRels.length).toBe(0);

    const srcRels = src!.db.select().from(knowledgeRelationships).all();
    expect(srcRels.length).toBe(0);
  });

  it("copies self-referential relationships (both endpoints in the target)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    const a = await createDocument(dataDir, "global", { filename: "e.md", content: "# E", createdBy: "agent" });
    const src = await openKnowledgeDb(dataDir, "global");
    await src!.db.insert(knowledgeRelationships).values({
      id: "rel-e-e",
      sourceDocumentId: a.id,
      targetDocumentId: a.id,
      relationType: "related",
      weight: 1,
      createdAt: new Date().toISOString(),
    });

    await moveDocumentAcrossScopes({ fromScope: "global", toScope: "session", documentId: a.id, dataDir, sessionId: "s1" });

    const dst = await openKnowledgeDb(dataDir, "session", undefined, "s1");
    const rels = dst!.db.select().from(knowledgeRelationships).all();
    expect(rels.length).toBe(1);
    expect(rels[0].id).toBe("rel-e-e");
    expect(rels[0].sourceDocumentId).toBe(a.id);
    expect(rels[0].targetDocumentId).toBe(a.id);
  });

  it("throws MoveError(404) when the source document does not exist", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    try {
      await moveDocumentAcrossScopes({ fromScope: "global", toScope: "session", documentId: "does-not-exist", dataDir, sessionId: "s1" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(404);
    }
  });
});
