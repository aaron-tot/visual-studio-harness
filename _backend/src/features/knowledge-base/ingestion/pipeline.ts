import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import type { KnowledgeScopeDb } from "../db";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "../db";
import { knowledgeDocuments, knowledgeChunks } from "../schema";
import type { KnowledgeBaseConfig } from "../../../../../_shared/types/config";
import { extractMetadata } from "../metadata-extraction";
import { chunkDocument } from "../chunking";
import { createVersion } from "../versions";
import { createJob } from "../jobs";
import type { IngestResult } from "../types";
import { MAX_FILE_SIZE_BYTES } from "../constants";

const SKIP_PATTERNS = [
  /^\./,         // dotfiles
  /\.swp$/,      // vim swap
  /~$/,          // emacs backup
  /\.bak$/i,     // generic backup
];

/**
 * Run ingestion: scan sources directory and index all files.
 * Also detects DB records for files that no longer exist in sources.
 */
export async function runIngestion(
  dataDir: string,
  scope: KbScope,
  db: KnowledgeScopeDb,
  config: KnowledgeBaseConfig,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<IngestResult> {
  const knowledgeDir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!knowledgeDir) return { added: 0, updated: 0, deleted: 0, failed: [] };
  const sourcesDir = join(knowledgeDir, "sources");
  if (!existsSync(sourcesDir)) {
    return { added: 0, updated: 0, deleted: 0, failed: [] };
  }

  const result: IngestResult = { added: 0, updated: 0, deleted: 0, failed: [] };

  // Read files on disk
  const entries = await readdir(sourcesDir, { withFileTypes: true });
  const seenFilenames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (SKIP_PATTERNS.some((p) => p.test(entry.name))) continue;
    seenFilenames.add(entry.name);

    try {
      const filepath = join(sourcesDir, entry.name);
      const fileStat = await stat(filepath);

      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        result.failed.push({ filename: entry.name, error: "File exceeds max size (10MB)" });
        continue;
      }

      const content = await readFile(filepath, "utf-8");
      const fileHash = createHash("sha256").update(content).digest("hex");

      const existing = await db.db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.filename, entry.name))
        .get();

      if (existing && existing.fileHash === fileHash) {
        continue;
      }

      if (existing) {
        await reIndexDocument(db, scope, existing.id, entry.name, content, fileHash, fileStat.size);
        result.updated++;
      } else {
        await indexDocument(db, scope, entry.name, filepath, content, fileHash, fileStat.size);
        result.added++;
      }
    } catch (err: any) {
      result.failed.push({ filename: entry.name, error: err.message });
    }
  }

  // Delete detection: find DB records with no matching file on disk
  const allDocs = await db.db
    .select({ id: knowledgeDocuments.id, filename: knowledgeDocuments.filename })
    .from(knowledgeDocuments)
    .all();

  for (const doc of allDocs) {
    if (!seenFilenames.has(doc.filename)) {
      // File was deleted — remove from DB
      await db.db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, doc.id));
      await db.db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id));
      result.deleted++;
    }
  }

  return result;
}

async function indexDocument(
  db: KnowledgeScopeDb,
  scope: KbScope,
  filename: string,
  filepath: string,
  content: string,
  fileHash: string,
  fileSize: number,
): Promise<void> {
  const now = new Date().toISOString();
  const docId = randomUUIDv7();
  const meta = extractMetadata(filename, content);
  const chunks = chunkDocument(filename, content);

  await db.db.insert(knowledgeDocuments).values({
    id: docId,
    filename,
    filepath,
    title: meta.title,
    topics: JSON.stringify(meta.topics),
    summary: meta.summary,
    contentType: filename.endsWith(".md") ? "markdown" : "text",
    fileHash,
    fileSize,
    status: "ready",
    createdBy: "user",
    scope,
    tags: "[]",
    chunkCount: chunks.length,
    createdAt: now,
    updatedAt: now,
  });

  await createVersion(db, docId, content, fileHash);

  for (const chunk of chunks) {
    const chunkId = randomUUIDv7();
    await db.db.insert(knowledgeChunks).values({
      id: chunkId,
      documentId: docId,
      content: chunk.content,
      section: chunk.section,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      hash: chunk.hash,
      embeddingModel: null,
      createdAt: now,
    });

    await createJob(db, "embed", scope, {
      chunkId,
      documentId: docId,
      content: chunk.content,
    });
  }
}

async function reIndexDocument(
  db: KnowledgeScopeDb,
  scope: KbScope,
  docId: string,
  filename: string,
  content: string,
  fileHash: string,
  fileSize: number,
): Promise<void> {
  const now = new Date().toISOString();
  const meta = extractMetadata(filename, content);
  const chunks = chunkDocument(filename, content);

  await db.db
    .delete(knowledgeChunks)
    .where(eq(knowledgeChunks.documentId, docId));

  await db.db
    .update(knowledgeDocuments)
    .set({
      title: meta.title,
      topics: JSON.stringify(meta.topics),
      summary: meta.summary,
      fileHash,
      fileSize,
      chunkCount: chunks.length,
      status: "ready",
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, docId));

  await createVersion(db, docId, content, fileHash);

  for (const chunk of chunks) {
    const chunkId = randomUUIDv7();
    await db.db.insert(knowledgeChunks).values({
      id: chunkId,
      documentId: docId,
      content: chunk.content,
      section: chunk.section,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      hash: chunk.hash,
      embeddingModel: null,
      createdAt: now,
    });

    await createJob(db, "embed", scope, {
      chunkId,
      documentId: docId,
      content: chunk.content,
    });
  }
}
