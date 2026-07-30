import type { FastifyInstance } from "fastify";
import type { KnowledgeBaseService } from "../knowledge-base-service";
import type { KbScope } from "../db";
import { openKnowledgeDb } from "../db";

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  kb: KnowledgeBaseService,
): void {
  // ── Search ──────────────────────────────────────────────────────
  app.get("/api/knowledge/search", async (request, reply) => {
    const q = request.query as {
      query: string;
      scope?: string;
      limit?: string;
      mode?: string;
    };
    if (!q.query?.trim()) {
      return reply.code(400).send({ error: "query is required" });
    }
    const scope = (q.scope as KbScope) || "global";
    const limit = q.limit ? parseInt(q.limit, 10) : 10;
    const { results, hybrid } = await kb.search(scope, q.query, {
      limit,
      mode: q.mode || "general",
    });
    return { results, hybrid, count: results.length };
  });

  // ── List documents ──────────────────────────────────────────────
  app.get("/api/knowledge/documents", async (request) => {
    const q = request.query as {
      scope?: string;
      extension?: string;
      status?: string;
      createdBy?: string;
    };
    const scope = (q.scope as KbScope) || "global";
    const docs = await kb.listDocuments(scope, {
      extension: q.extension,
      status: q.status,
      createdBy: q.createdBy,
    });
    return { documents: docs, count: docs.length };
  });

  // ── Open document ───────────────────────────────────────────────
  app.get("/api/knowledge/documents/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const q = request.query as { scope?: string; maxChars?: string };
    const scope = (q.scope as KbScope) || "global";
    const maxChars = q.maxChars ? parseInt(q.maxChars, 10) : undefined;
    const doc = await kb.openDocument(scope, params.id, maxChars);
    if (!doc) {
      return reply.code(404).send({ error: "Document not found" });
    }
    return doc;
  });

  // ── Create document ─────────────────────────────────────────────
  app.post<{
    Body: {
      filename: string;
      content: string;
      tags?: string[];
      createdBy?: string;
      scope?: string;
    };
  }>("/api/knowledge/documents", async (request, reply) => {
    const { filename, content, tags, createdBy, scope } = request.body;
    if (!filename?.trim() || !content?.trim()) {
      return reply.code(400).send({ error: "filename and content are required" });
    }
    const doc = await kb.createDocument(
      (scope as KbScope) || "global",
      { filename, content, tags, createdBy },
    );
    return { ok: true, document: doc };
  });

  // ── Edit document ───────────────────────────────────────────────
  app.put<{
    Body: { content: string; scope?: string };
  }>("/api/knowledge/documents/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const { content, scope } = request.body;
    if (!content?.trim()) {
      return reply.code(400).send({ error: "content is required" });
    }
    const doc = await kb.editDocument(
      (scope as KbScope) || "global",
      params.id,
      content,
    );
    return { ok: true, document: doc };
  });

  // ── Delete document ─────────────────────────────────────────────
  app.delete<{
    Body: { scope?: string; confirmed?: boolean };
  }>("/api/knowledge/documents/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { scope?: string; confirmed?: boolean } | undefined;
    const scope = (body?.scope as KbScope) || "global";
    const confirmed = body?.confirmed ?? false;
    const result = await kb.deleteDocument(scope, params.id, confirmed);
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return { ok: true, ...result };
  });

  // ── Ingest ──────────────────────────────────────────────────────
  app.post<{
    Body: { scope?: string };
  }>("/api/knowledge/ingest", async (request) => {
    const scope = (request.body?.scope as KbScope) || "global";
    const result = await kb.ingest(scope);
    return { ok: true, ...result };
  });

  // ── Groups ──────────────────────────────────────────────────────
  app.get("/api/knowledge/groups", async (request) => {
    const q = request.query as { scope?: string };
    const scope = (q.scope as KbScope) || "global";
    const { listGroupRecords } = await import("../service-queries");
    const groups = await listGroupRecords(kb.baseDataDir, scope);
    return { groups };
  });

  app.post<{
    Body: { name: string; color?: string; scope?: string };
  }>("/api/knowledge/groups", async (request, reply) => {
    const { name, color, scope: bodyScope } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const scope = (bodyScope as KbScope) || "global";
    const kbDb = await openKnowledgeDb(kb.baseDataDir, scope);
    if (!kbDb) return reply.code(500).send({ error: "Cannot open knowledge DB" });

    const { createGroup } = await import("../service-mutations");
    const group = await createGroup(kbDb, {
      name: name.trim(),
      color: color || "#6366f1",
      scope,
    });
    return { ok: true, group };
  });

  app.put<{
    Body: { name?: string; color?: string; sortOrder?: number; documentIds?: string[]; scope?: string };
  }>("/api/knowledge/groups/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body;
    const scope = (body.scope as KbScope) || "global";
    const kbDb = await openKnowledgeDb(kb.baseDataDir, scope);
    if (!kbDb) return reply.code(500).send({ error: "Cannot open knowledge DB" });

    if (body.documentIds) {
      const { setGroupDocuments } = await import("../service-mutations");
      await setGroupDocuments(kbDb, params.id, body.documentIds);
    }
    if (body.name !== undefined || body.color !== undefined || body.sortOrder !== undefined) {
      const { updateGroup } = await import("../service-mutations");
      await updateGroup(kbDb, params.id, { name: body.name, color: body.color, sortOrder: body.sortOrder });
    }
    return { ok: true };
  });

  app.delete("/api/knowledge/groups/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const q = request.query as { scope?: string };
    const scope = (q.scope as KbScope) || "global";
    const kbDb = await openKnowledgeDb(kb.baseDataDir, scope);
    if (!kbDb) return reply.code(500).send({ error: "Cannot open knowledge DB" });

    const { deleteGroup } = await import("../service-mutations");
    await deleteGroup(kbDb, params.id);
    return { ok: true };
  });
}
