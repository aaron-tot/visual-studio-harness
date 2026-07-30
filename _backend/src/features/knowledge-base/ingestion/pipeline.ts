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

  const entries = await readdir(sourcesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (SKIP_PATTERNS.some((p) => p.test(entry.name))) continue;

    try {
      const filepath = join(sourcesDir, entry.name);
      const fileStat = await stat(filepath);

      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        result.failed.push({ filename: entry.name, error: "File exceeds max size (10MB)" });
        continue;
      }

      const content = await readFile(filepath, "utf-8");
      const fileHash = simpleHash(content);

      // Check for existing document with same filename in this scope
      const existing = await db.db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.filename, entry.name))
        .get();

      if (existing && existing.fileHash === fileHash) {
        // No change — skip
        continue;
      }

      if (existing) {
        // Hash changed — re-index
        await reIndexDocument(db, existing.id, entry.name, content, fileHash, fileStat.size);
        result.updated++;
      } else {
        // New document
        await indexDocument(db, entry.name, filepath, content, fileHash, fileStat.size);
        result.added++;
      }
    } catch (err: any) {
      result.failed.push({ filename: entry.name, error: err.message });
    }
  }

  return result;
}

async function indexDocument(
  db: KnowledgeScopeDb,
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
    scope: "global",
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

    // Queue embedding job for this chunk
    await createJob(db, "embed", "global" as KbScope, {
      chunkId,
      documentId: docId,
      content: chunk.content,
    });
  }
}

async function reIndexDocument(
  db: KnowledgeScopeDb,
  docId: string,
  filename: string,
  content: string,
  fileHash: string,
  fileSize: number,
): Promise<void> {
  const now = new Date().toISOString();
  const meta = extractMetadata(filename, content);
  const chunks = chunkDocument(filename, content);

  // Delete old chunks (cascade removes FTS rows via triggers)
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

    await createJob(db, "embed", "global" as KbScope, {
      chunkId,
      documentId: docId,
      content: chunk.content,
    });
  }
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
