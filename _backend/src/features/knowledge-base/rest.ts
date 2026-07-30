import type { FastifyInstance } from "fastify";
import type { KnowledgeBaseService } from "./knowledge-base-service";
import { openKnowledgeDb, type KbScope } from "./db";

export function registerKnowledgeRoutes(app: FastifyInstance, kb: KnowledgeBaseService): void {
  // ── List documents ────────────────────────────────────────────────
  app.get("/api/knowledge", async (request) => {
    const q = request.query as { scope?: string; tags?: string; extension?: string; status?: string; createdBy?: string };
    const scope = (q.scope as KbScope) || "global";
    return kb.listDocuments(scope, {
      tags: q.tags ? q.tags.split(",") : undefined,
      extension: q.extension,
      status: q.status,
      createdBy: q.createdBy,
    });
  });

  // ── Search ────────────────────────────────────────────────────────
  app.get("/api/knowledge/search", async (request) => {
    const q = request.query as {
      query: string;
      scope?: string;
      limit?: string;
      mode?: string;
      extension?: string;
      createdBy?: string;
    };
    if (!q.query?.trim()) {
      return { results: [], hybrid: false, error: "query is required" };
    }
    const scope = (q.scope as KbScope) || "global";
    const { results, hybrid } = await kb.search(scope, q.query, {
      limit: q.limit ? parseInt(q.limit, 10) : 10,
      mode: q.mode || "general",
      filters: {
        extension: q.extension,
        createdBy: q.createdBy,
      },
    });
    return { results, hybrid };
  });

  // ── Open document ─────────────────────────────────────────────────
  app.get("/api/knowledge/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { scope?: string; maxChars?: string };
    const scope = (q.scope as KbScope) || "global";
    const maxChars = q.maxChars ? parseInt(q.maxChars, 10) : undefined;
    const doc = await kb.openDocument(scope, id, maxChars);
    if (!doc) return reply.code(404).send({ error: "Document not found" });
    return doc;
  });

  // ── Create document ───────────────────────────────────────────────
  app.post<{
    Body: { filename: string; content: string; tags?: string[]; scope?: string; createdBy?: string };
  }>("/api/knowledge/create", async (request, reply) => {
    const { filename, content, tags, scope, createdBy } = request.body;
    if (!filename?.trim() || !content?.trim()) {
      return reply.code(400).send({ error: "filename and content are required" });
    }
    if (!filename.endsWith(".md") && !filename.endsWith(".txt")) {
      return reply.code(400).send({ error: "filename must end in .md or .txt" });
    }
    try {
      const doc = await kb.createDocument((scope as KbScope) || "global", {
        filename,
        content,
        tags,
        scope: scope || "global",
        createdBy: createdBy || "user",
      });
      return { ok: true, ...doc };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── Edit document ─────────────────────────────────────────────────
  app.put<{
    Body: { content: string; scope?: string };
  }>("/api/knowledge/:id/edit", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { content, scope } = request.body;
    if (!content?.trim()) {
      return reply.code(400).send({ error: "content is required" });
    }
    try {
      const doc = await kb.editDocument((scope as KbScope) || "global", id, content);
      return { ok: true, ...doc };
    } catch (e: any) {
      if (e.message === "Document not found") {
        return reply.code(404).send({ error: e.message });
      }
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── Delete document ───────────────────────────────────────────────
  app.delete<{
    Body: { confirmed?: boolean; scope?: string };
  }>("/api/knowledge/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { confirmed?: boolean; scope?: string } | undefined;
    const confirmed = body?.confirmed ?? false;
    const scope = (body?.scope as KbScope) || "global";
    const result = await kb.deleteDocument(scope, id, confirmed);
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return { ok: true };
  });

  // ── Ingest ────────────────────────────────────────────────────────
  app.post<{
    Body: { scope?: string };
  }>("/api/knowledge/ingest", async (request) => {
    const scope = (request.body?.scope as KbScope) || "global";
    const result = await kb.ingest(scope);
    return result;
  });

  // ── Groups ────────────────────────────────────────────────────────
  app.get("/api/knowledge/groups", async (request) => {
    const q = request.query as { scope?: string };
    const scope = (q.scope as KbScope) || "global";
    const db = await openKnowledgeDb(kb.baseDataDir, scope);
    if (!db) return { groups: [] };

    const groups = db.sqlite
      .query("SELECT id, name, color, sort_order, created_at, updated_at FROM knowledge_groups WHERE scope = ? ORDER BY sort_order")
      .all(scope) as { id: string; name: string; color: string; sort_order: number; created_at: string; updated_at: string }[];

    const result = [];
    for (const g of groups) {
      const docs = db.sqlite
        .query(
          `SELECT d.id, d.filename, d.title, d.status
           FROM knowledge_group_documents gd
           JOIN knowledge_documents d ON d.id = gd.document_id
           WHERE gd.group_id = ?
           ORDER BY gd.sort_order`,
        )
        .all(g.id) as { id: string; filename: string; title: string; status: string }[];

      result.push({
        id: g.id,
        name: g.name,
        color: g.color,
        sortOrder: g.sort_order,
        documents: docs,
      });
    }

    return { groups: result };
  });

  app.put<{
    Body: { groups: { id?: string; name: string; color?: string; documentIds?: string[] }[]; scope?: string };
  }>("/api/knowledge/groups", async (request, reply) => {
    const { groups, scope } = request.body;
    const sc = (scope as KbScope) || "global";
    const db = await openKnowledgeDb(kb.baseDataDir, sc);
    if (!db) return reply.code(500).send({ error: "Failed to open DB" });

    // Delete all groups for this scope (cascade removes junction rows)
    db.sqlite.run("DELETE FROM knowledge_groups WHERE scope = ?", [sc]);

    // Insert groups
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const groupId = g.id || crypto.randomUUID();
      const now = new Date().toISOString();
      db.sqlite.run(
        "INSERT INTO knowledge_groups (id, name, color, sort_order, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [groupId, g.name, g.color || "#6366f1", i, sc, now, now],
      );

      // Insert document links
      const docIds = g.documentIds || [];
      for (let j = 0; j < docIds.length; j++) {
        db.sqlite.run(
          "INSERT OR IGNORE INTO knowledge_group_documents (id, group_id, document_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
          [crypto.randomUUID(), groupId, docIds[j], j, now],
        );
      }
    }

    return { ok: true };
  });
}
