import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "./db";
import { knowledgeDocuments } from "./schema";
import { extractMetadata } from "./metadata-extraction";
import { chunkDocument } from "./chunking";
import type { DocumentMeta, CreateDocumentInput, DeleteResult } from "./types";
import { AGENT_FILENAME_PREFIX } from "./constants";

export async function createDocument(
  dataDir: string,
  scope: KbScope,
  input: CreateDocumentInput,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Knowledge DB not available for scope: " + scope);

  const now = new Date().toISOString();
  const id = randomUUIDv7();
  const isAgent = input.createdBy === "agent";
  const filename = isAgent ? `${AGENT_FILENAME_PREFIX}${input.filename}` : input.filename;
  const meta = extractMetadata(filename, input.content);

  // Write source file at correct scope path
  const knowledgeDir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!knowledgeDir) throw new Error("Cannot resolve knowledge dir for scope: " + scope);
  const sourcesDir = join(knowledgeDir, "sources");
  await mkdir(sourcesDir, { recursive: true });
  const filepath = join(sourcesDir, filename);
  await writeFile(filepath, input.content, "utf-8");

  const chunks = chunkDocument(filename, input.content);

  await kb.db.insert(knowledgeDocuments).values({
    id,
    filename,
    filepath,
    title: meta.title,
    topics: JSON.stringify(meta.topics),
    summary: meta.summary,
    contentType: filename.endsWith(".md") ? "markdown" : "text",
    fileHash: hashContent(input.content),
    fileSize: Buffer.byteLength(input.content, "utf-8"),
    status: "ready",
    createdBy: input.createdBy || "user",
    scope,
    tags: JSON.stringify(input.tags || []),
    chunkCount: chunks.length,
    createdAt: now,
    updatedAt: now,
  });

  return getDocMeta(kb, id);
}

export async function editDocument(
  dataDir: string,
  scope: KbScope,
  id: string,
  content: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DocumentMeta> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Knowledge DB not available for scope: " + scope);

  const existing = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!existing) throw new Error("Document not found: " + id);

  const now = new Date().toISOString();
  const meta = extractMetadata(existing.filename, content);
  const chunks = chunkDocument(existing.filename, content);

  // Update source file at correct scope path
  const knowledgeDir = resolveKnowledgeDir(dataDir, scope, workspaceRoot, sessionId);
  if (!knowledgeDir) throw new Error("Cannot resolve knowledge dir for scope: " + scope);
  const filepath = join(knowledgeDir, "sources", existing.filename);
  await writeFile(filepath, content, "utf-8");

  await kb.db
    .update(knowledgeDocuments)
    .set({
      title: meta.title,
      topics: JSON.stringify(meta.topics),
      summary: meta.summary,
      fileHash: hashContent(content),
      fileSize: Buffer.byteLength(content, "utf-8"),
      chunkCount: chunks.length,
      status: "ready",
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, id));

  return getDocMeta(kb, id);
}

export async function deleteDocument(
  dataDir: string,
  scope: KbScope,
  id: string,
  _confirmed: boolean,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DeleteResult> {
  const kb = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!kb) throw new Error("Knowledge DB not available for scope: " + scope);

  const existing = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!existing) throw new Error("Document not found: " + id);

  await kb.db
    .delete(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id));

  return { ok: true, deleted: true, documentId: id };
}

async function getDocMeta(kb: Awaited<ReturnType<typeof openKnowledgeDb>>, id: string): Promise<DocumentMeta> {
  if (!kb) throw new Error("Knowledge DB not available");
  const row = await kb.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .get();

  if (!row) throw new Error("Document not found after mutation: " + id);

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

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
