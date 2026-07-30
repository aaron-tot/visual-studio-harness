import { and, eq, like, inArray, sql } from "drizzle-orm";
import { openKnowledgeDb, type KbScope } from "./db";
import { knowledgeDocuments, knowledgeChunks, knowledgeDocumentVersions } from "./schema";
import type { DocumentMeta, DocumentContent, SearchFilters } from "./types";

export async function listDocuments(
  dataDir: string,
  scope: KbScope,
  filters?: { tags?: string[]; extension?: string; status?: string; createdBy?: string },
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta[]> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) return [];

  const conditions = [eq(knowledgeDocuments.scope, scope)];

  if (filters?.status) {
    conditions.push(eq(knowledgeDocuments.status, filters.status));
  }
  if (filters?.extension) {
    conditions.push(like(knowledgeDocuments.filename, `%${filters.extension}`));
  }
  if (filters?.createdBy) {
    conditions.push(eq(knowledgeDocuments.createdBy, filters.createdBy));
  }
  if (filters?.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      conditions.push(like(knowledgeDocuments.tags, `%"${tag}"%`));
    }
  }

  const rows = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(and(...conditions))
    .orderBy(knowledgeDocuments.updatedAt);

  return rows.map(rowToMeta);
}

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

  // Get the latest version content
  const version = await kb.db
    .select()
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, id))
    .orderBy(knowledgeDocumentVersions.versionNumber)
    .get();

  if (!version) return null;

  let content = version.content;
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

function rowToMeta(row: typeof knowledgeDocuments.$inferSelect): DocumentMeta {
  return {
    id: row.id,
    filename: row.filename,
    filepath: row.filepath,
    title: row.title,
    topics: safeJsonParse<string[]>(row.topics, []),
    summary: row.summary,
    contentType: row.contentType,
    fileHash: row.fileHash,
    fileSize: row.fileSize,
    status: row.status,
    createdBy: row.createdBy,
    scope: row.scope,
    tags: safeJsonParse<string[]>(row.tags, []),
    chunkCount: row.chunkCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
