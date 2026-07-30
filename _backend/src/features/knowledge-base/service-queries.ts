import { eq, like, and, sql } from "drizzle-orm";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "./db";
import { knowledgeDocuments, knowledgeChunks, knowledgeDocumentVersions } from "./schema";
import type { DocumentMeta, DocumentContent } from "./types";

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
