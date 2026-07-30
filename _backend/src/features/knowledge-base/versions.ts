import { eq, desc, max } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import type { KnowledgeScopeDb } from "./db";
import { knowledgeDocumentVersions } from "./schema";

export interface VersionRecord {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  fileHash: string;
  fileSize: number;
  createdAt: string;
}

/**
 * Create a new version entry for a document.
 * Returns the version record.
 */
export async function createVersion(
  kb: KnowledgeScopeDb,
  documentId: string,
  content: string,
  fileHash: string,
): Promise<VersionRecord> {
  const now = new Date().toISOString();
  const id = randomUUIDv7();

  // Get next version number
  const lastVersion = await kb.db
    .select({ maxVersion: max(knowledgeDocumentVersions.versionNumber) })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, documentId))
    .get();

  const versionNumber = (lastVersion?.maxVersion ?? 0) + 1;

  await kb.db.insert(knowledgeDocumentVersions).values({
    id,
    documentId,
    versionNumber,
    content,
    fileHash,
    fileSize: Buffer.byteLength(content, "utf-8"),
    createdAt: now,
  });

  return {
    id,
    documentId,
    versionNumber,
    content,
    fileHash,
    fileSize: Buffer.byteLength(content, "utf-8"),
    createdAt: now,
  };
}

/**
 * Get the latest version of a document.
 */
export async function getLatestVersion(
  kb: KnowledgeScopeDb,
  documentId: string,
): Promise<VersionRecord | null> {
  const row = await kb.db
    .select()
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, documentId))
    .orderBy(desc(knowledgeDocumentVersions.versionNumber))
    .get();

  return row ? {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    content: row.content,
    fileHash: row.fileHash,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
  } : null;
}
