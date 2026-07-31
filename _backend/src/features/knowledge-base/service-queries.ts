import { eq, like, and, sql, desc } from "drizzle-orm";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "./db";
import { knowledgeDocuments, knowledgeChunks, knowledgeDocumentVersions, knowledgeGroups, knowledgeGroupDocuments } from "./schema";
import type { DocumentMeta, DocumentContent } from "./types";
import type { Database } from "bun:sqlite";

/**
 * List documents with optional filters.
 */
export async function listDocuments(
  dataDir: string,
  scope: KbScope,
  filters?: { tags?: string[]; extension?: string; status?: string; createdBy?: string },
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta[]> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return [];

  const conditions: ReturnType<typeof eq>[] = [eq(knowledgeDocuments.scope, scope)];

  if (filters?.status) {
    conditions.push(eq(knowledgeDocuments.status, filters.status));
  }
  if (filters?.createdBy) {
    conditions.push(eq(knowledgeDocuments.createdBy, filters.createdBy));
  }

  let rows;
  if (filters?.extension) {
    rows = await kb.db
      .select()
      .from(knowledgeDocuments)
      .where(and(...conditions, like(knowledgeDocuments.filename, `%${filters.extension}`)))
      .orderBy(sql`created_at DESC`);
  } else {
    rows = await kb.db
      .select()
      .from(knowledgeDocuments)
      .where(and(...conditions))
      .orderBy(sql`created_at DESC`);
  }

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    filepath: r.filepath,
    title: r.title,
    topics: safeJsonParse(r.topics),
    summary: r.summary,
    contentType: r.contentType,
    fileHash: r.fileHash,
    fileSize: r.fileSize,
    status: r.status,
    createdBy: r.createdBy,
    scope: r.scope,
    tags: safeJsonParse(r.tags),
    chunkCount: r.chunkCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    extension: r.filename.includes(".") ? r.filename.split(".").pop() || "" : "",
  }));
}

/**
 * Open a document's full content by reading the latest version.
 */
export async function openDocument(
  dataDir: string,
  scope: KbScope,
  id: string,
  maxChars?: number,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentContent | null> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return null;

  const doc = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!doc) return null;

  // Get latest version content
  const version = await kb.db
    .select({ content: knowledgeDocumentVersions.content })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, doc.id))
    .orderBy(sql`version_number DESC`)
    .get();

  let content = version?.content || "";
  let contentTruncated = false;

  if (maxChars && content.length > maxChars) {
    content = content.slice(0, maxChars);
    contentTruncated = true;
  }

  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title,
    content,
    contentTruncated,
  };
}

function safeJsonParse(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Groups ─────────────────────────────────────────────────────────

export async function listGroupRecords(
  dataDir: string,
  scope: KbScope,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<Array<{ id: string; name: string; color: string; sortOrder: number; scope: string; documentCount: number }>> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return [];
  const rows = await kb.db
    .select()
    .from(knowledgeGroups)
    .where(eq(knowledgeGroups.scope, scope))
    .orderBy(sql`sort_order ASC`)
    .all();
  const result: Array<{ id: string; name: string; color: string; sortOrder: number; scope: string; documentCount: number }> = [];
  for (const g of rows) {
    const row = kb.sqlite
      .prepare("SELECT count(*) as c FROM knowledge_group_documents WHERE group_id = ?")
      .get(g.id) as { c: number } | undefined;
    result.push({ ...g, documentCount: row?.c ?? 0 });
  }
  return result;
}

export async function listGroupDocumentIds(
  dataDir: string,
  scope: KbScope,
  groupId: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<string[]> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return [];
  const rows = await kb.db
    .select({ documentId: knowledgeGroupDocuments.documentId })
    .from(knowledgeGroupDocuments)
    .where(eq(knowledgeGroupDocuments.groupId, groupId))
    .orderBy(sql`sort_order ASC`)
    .all();
  return rows.map((r) => r.documentId);
}

export async function getGroup(
  dataDir: string,
  scope: KbScope,
  groupId: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<{ id: string; name: string; color: string; sortOrder: number; scope: string; documentIds: string[] } | null> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return null;
  const group = await kb.db
    .select()
    .from(knowledgeGroups)
    .where(eq(knowledgeGroups.id, groupId))
    .get();
  if (!group) return null;
  const docIds = await listGroupDocumentIds(dataDir, scope, groupId, workspaceRoot, sessionId);
  return { ...group, documentIds: docIds };
}

/**
 * Get embedding info for all chunks of a document
 */
export async function getDocumentEmbeddings(kb: { db: any; sqlite: Database }, docId: string): Promise<Array<{
  id: string;
  chunkIndex: number;
  embeddingModel: string | null;
  dimensions: number | null;
  hasEmbedding: boolean;
  content: string;
  section: string;
  tokenCount: number;
}>> {
  const chunks = await kb.db
    .select({
      id: knowledgeChunks.id,
      chunkIndex: knowledgeChunks.chunkIndex,
      embeddingModel: knowledgeChunks.embeddingModel,
      content: knowledgeChunks.content,
      section: knowledgeChunks.section,
      hash: knowledgeChunks.hash,
      tokenCount: knowledgeChunks.tokenCount,
    })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.documentId, docId))
    .orderBy(knowledgeChunks.chunkIndex)
    .all();

  // Check vec0 table for actual embeddings
  const vecCheck = kb.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_embeddings'")
    .get();

  const chunkEmbeddings: Record<string, boolean> = {};
  if (vecCheck) {
    const rows = kb.sqlite
      .prepare("SELECT chunk_id FROM knowledge_embeddings")
      .all() as { chunk_id: string }[];
    for (const r of rows) chunkEmbeddings[r.chunk_id] = true;
  }

  // Get embedding metadata (by chunk_hash)
  // Get embedding metadata (by chunk_hash)
  const metaRows = kb.sqlite
    .prepare("SELECT chunk_hash, model, dimensions FROM knowledge_embedding_meta WHERE chunk_hash IN (" + chunks.map(() => "?").join(",") + ")")
    .all(...chunks.map(c => c.hash)) as { chunk_hash: string; model: string; dimensions: number }[];

  const metaMap = new Map(metaRows.map(m => [m.chunk_hash, m]));

  return chunks.map(c => {
    const meta = metaMap.get(c.hash);
    return {
      id: c.id,
      chunkIndex: c.chunkIndex,
      embeddingModel: meta?.model || null,
      dimensions: meta?.dimensions || null,
      hasEmbedding: chunkEmbeddings[c.id] === true,
      content: c.content,
      section: c.section || "Document",
      tokenCount: c.tokenCount || 0,
    };
  });
}
