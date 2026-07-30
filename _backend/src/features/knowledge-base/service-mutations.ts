import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUIDv7 } from "bun";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "./db";
import type { KnowledgeScopeDb } from "./db";
import { knowledgeDocuments, knowledgeChunks, knowledgeDocumentVersions, knowledgeGroups, knowledgeGroupDocuments } from "./schema";
import type { DocumentMeta, CreateDocumentInput, DeleteResult, DocumentContent } from "./types";
import { extractMetadata } from "./metadata-extraction";
import { chunkDocument } from "./chunking";
import { createVersion } from "./versions";
import { createJob } from "./jobs";
import { AGENT_FILENAME_PREFIX } from "./constants";

/**
 * Create a new knowledge document.
 * Writes file to sources dir, then indexes it.
 */
export async function createDocument(
  dataDir: string,
  scope: KbScope,
  input: CreateDocumentInput,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta> {
  const knowledgeDir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!knowledgeDir) throw new Error("Cannot resolve knowledge directory for scope: " + scope);

  const sourcesDir = join(knowledgeDir, "sources");
  await mkdir(sourcesDir, { recursive: true });

  // Write file to sources
  const filepath = join(sourcesDir, input.filename);
  await writeFile(filepath, input.content, "utf-8");

  // Index the document
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Cannot open knowledge database");

  const now = new Date().toISOString();
  const docId = randomUUIDv7();
  const meta = extractMetadata(input.filename, input.content);
  const chunks = chunkDocument(input.filename, input.content);
  const fileHash = createHash("sha256").update(input.content).digest("hex");

  await kb.db.insert(knowledgeDocuments).values({
    id: docId,
    filename: input.filename,
    filepath,
    title: meta.title,
    topics: JSON.stringify(meta.topics),
    summary: meta.summary,
    contentType: input.filename.endsWith(".md") ? "markdown" : "text",
    fileHash,
    fileSize: input.content.length,
    status: "ready",
    createdBy: input.createdBy || "user",
    scope,
    tags: JSON.stringify(input.tags || []),
    chunkCount: chunks.length,
    createdAt: now,
    updatedAt: now,
  });

  await createVersion(kb, docId, input.content, fileHash);

  for (const chunk of chunks) {
    const chunkId = randomUUIDv7();
    await kb.db.insert(knowledgeChunks).values({
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

    await createJob(kb, "embed", scope, { chunkId, documentId: docId, content: chunk.content });
  }

  return {
    id: docId,
    filename: input.filename,
    filepath,
    title: meta.title,
    topics: meta.topics,
    summary: meta.summary,
    contentType: input.filename.endsWith(".md") ? "markdown" : "text",
    fileHash,
    fileSize: input.content.length,
    status: "ready",
    createdBy: input.createdBy || "user",
    scope,
    tags: input.tags || [],
    chunkCount: chunks.length,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edit an existing document by replacing its content.
 * Agent-created docs can be edited freely.
 */
export async function editDocument(
  dataDir: string,
  scope: KbScope,
  id: string,
  content: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Cannot open knowledge database");

  const existing = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!existing) throw new Error("Document not found");

  const now = new Date().toISOString();
  const fileHash = createHash("sha256").update(content).digest("hex");
  const meta = extractMetadata(existing.filename, content);
  const chunks = chunkDocument(existing.filename, content);

  // Delete old chunks
  await kb.db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, id));

  // Update document record
  await kb.db
    .update(knowledgeDocuments)
    .set({
      title: meta.title,
      topics: JSON.stringify(meta.topics),
      summary: meta.summary,
      fileHash,
      fileSize: content.length,
      chunkCount: chunks.length,
      status: "ready",
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, id));

  // Update file on disk
  if (existing.filepath && existsSync(existing.filepath)) {
    await writeFile(existing.filepath, content, "utf-8");
  }

  await createVersion(kb, id, content, fileHash);

  for (const chunk of chunks) {
    const chunkId = randomUUIDv7();
    await kb.db.insert(knowledgeChunks).values({
      id: chunkId,
      documentId: id,
      content: chunk.content,
      section: chunk.section,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      hash: chunk.hash,
      embeddingModel: null,
      createdAt: now,
    });

    await createJob(kb, "embed", scope, { chunkId, documentId: id, content: chunk.content });
  }

  return {
    id: existing.id,
    filename: existing.filename,
    filepath: existing.filepath,
    title: meta.title,
    topics: meta.topics,
    summary: meta.summary,
    contentType: existing.contentType,
    fileHash,
    fileSize: content.length,
    status: "ready",
    createdBy: existing.createdBy,
    scope: existing.scope,
    tags: safeJsonParse(existing.tags),
    chunkCount: chunks.length,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

/**
 * Delete a document.
 * Agent-created docs can be deleted freely.
 * User-created docs require confirmation.
 */
export async function deleteDocument(
  dataDir: string,
  scope: KbScope,
  id: string,
  confirmed: boolean,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DeleteResult> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Cannot open knowledge database");

  const existing = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!existing) {
    return { ok: false, error: "Document not found" };
  }

  // Agent-created docs can always be deleted; user docs need confirmation
  if (existing.createdBy === "user" && !confirmed) {
    return {
      ok: false,
      error: "User-created documents require explicit confirmation (confirmed: true) to delete",
    };
  }

  // Cascade delete chunks, versions, etc.
  await kb.db
    .delete(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, id));
  await kb.db
    .delete(knowledgeChunks)
    .where(eq(knowledgeChunks.documentId, id));
  await kb.db
    .delete(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id));

  // Remove source file
  if (existing.filepath && existsSync(existing.filepath)) {
    try {
      await unlink(existing.filepath);
    } catch {
      // file may already be gone
    }
  }

  return { ok: true, deleted: true, documentId: id };
}

function safeJsonParse(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Group CRUD ─────────────────────────────────────────────────────

export async function createGroup(
  kb: KnowledgeScopeDb,
  input: { name: string; color: string; scope: KbScope },
): Promise<{ id: string; name: string; color: string; sortOrder: number; scope: string }> {
  const now = new Date().toISOString();
  const id = randomUUIDv7();
  await kb.db.insert(knowledgeGroups).values({
    id,
    name: input.name,
    color: input.color,
    sortOrder: 0,
    scope: input.scope,
    createdAt: now,
    updatedAt: now,
  });
  return { id, name: input.name, color: input.color, sortOrder: 0, scope: input.scope };
}

export async function updateGroup(
  kb: KnowledgeScopeDb,
  id: string,
  updates: { name?: string; color?: string; sortOrder?: number },
): Promise<void> {
  await kb.db
    .update(knowledgeGroups)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(knowledgeGroups.id, id));
}

export async function setGroupDocuments(
  kb: KnowledgeScopeDb,
  groupId: string,
  documentIds: string[],
): Promise<void> {
  await kb.db
    .delete(knowledgeGroupDocuments)
    .where(eq(knowledgeGroupDocuments.groupId, groupId));
  const now = new Date().toISOString();
  for (let i = 0; i < documentIds.length; i++) {
    await kb.db.insert(knowledgeGroupDocuments).values({
      id: randomUUIDv7(),
      groupId,
      documentId: documentIds[i],
      sortOrder: i,
      createdAt: now,
    });
  }
}

export async function deleteGroup(
  kb: KnowledgeScopeDb,
  id: string,
): Promise<void> {
  await kb.db
    .delete(knowledgeGroupDocuments)
    .where(eq(knowledgeGroupDocuments.groupId, id));
  await kb.db
    .delete(knowledgeGroups)
    .where(eq(knowledgeGroups.id, id));
}
