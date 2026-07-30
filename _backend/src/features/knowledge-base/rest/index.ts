import type { FastifyInstance } from "fastify";
import type { KnowledgeBaseService } from "../knowledge-base-service";
import type { KbScope } from "../db";

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
    const scope = (q.scope as KbScope) || "session";
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
    const scope = (q.scope as KbScope) || "session";
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
    const scope = (q.scope as KbScope) || "session";
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
      (scope as KbScope) || "session",
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
      (scope as KbScope) || "session",
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
    const scope = (body?.scope as KbScope) || "session";
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
    const scope = (request.body?.scope as KbScope) || "session";
    const result = await kb.ingest(scope);
    return { ok: true, ...result };
  });
}
