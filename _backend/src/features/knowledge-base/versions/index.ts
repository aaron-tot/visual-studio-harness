import { eq, sql } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import type { KnowledgeScopeDb } from "../db";
import { knowledgeDocumentVersions } from "../schema";

/**
 * Create a new version record for a document.
 * Automatically increments the version number.
 */
export async function createVersion(
  db: KnowledgeScopeDb,
  documentId: string,
  content: string,
  fileHash: string,
  fileSize?: number,
): Promise<string> {
  const now = new Date().toISOString();
  const id = randomUUIDv7();

  // Get next version number
  const latest = await db.db
    .select({ maxVersion: sql<number>`COALESCE(MAX(version_number), 0)` })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, documentId))
    .get();

  const versionNumber = (latest?.maxVersion ?? 0) + 1;

  await db.db.insert(knowledgeDocumentVersions).values({
    id,
    documentId,
    versionNumber,
    content,
    fileHash,
    fileSize: fileSize ?? content.length,
    createdAt: now,
  });

  return id;
}

/**
 * List all versions for a document, ordered newest first.
 */
export async function listVersions(
  db: KnowledgeScopeDb,
  documentId: string,
): Promise<Array<{ id: string; versionNumber: number; fileHash: string; fileSize: number; createdAt: string }>> {
  return db.db
    .select({
      id: knowledgeDocumentVersions.id,
      versionNumber: knowledgeDocumentVersions.versionNumber,
      fileHash: knowledgeDocumentVersions.fileHash,
      fileSize: knowledgeDocumentVersions.fileSize,
      createdAt: knowledgeDocumentVersions.createdAt,
    })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, documentId))
    .orderBy(sql`version_number DESC`);
}

/**
 * Get a specific version's content.
 */
export async function getVersionContent(
  db: KnowledgeScopeDb,
  versionId: string,
): Promise<string | null> {
  const record = await db.db
    .select({ content: knowledgeDocumentVersions.content })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId))
    .get();
  return record?.content ?? null;
}
