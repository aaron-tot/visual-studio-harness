import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createDocument } from "./service-mutations";
import { moveDocumentAcrossScopes } from "./service-move";
import { openKnowledgeDb, closeAllKnowledgeDbs } from "./db";
import { knowledgeDocuments, knowledgeChunks } from "./schema";
import { eq } from "drizzle-orm";
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
});
