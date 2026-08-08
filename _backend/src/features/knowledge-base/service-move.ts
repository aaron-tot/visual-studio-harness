import { join, dirname } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { eq, or } from "drizzle-orm";
import { openKnowledgeDb, resolveKnowledgeDir, type KbScope } from "./db";
import {
  knowledgeDocuments,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeRelationships,
} from "./schema";
import { deleteDocumentEmbeddings } from "./sqlite/vec";
import { MoveError } from "../../rest/scope-move";

export interface MoveDocumentParams {
  fromScope: KbScope;
  toScope: KbScope;
  documentId: string;
  dataDir: string;
  workspaceRoot?: string;
  sessionId?: string;
}

/**
 * True move of a knowledge document between scope DBs: preserves the document
 * id, chunks (incl. FTS rows via the target trigger), embeddings (vec0, cache,
 * meta), versions, and relationships, and relocates the source file. Removes
 * the document from the source scope (cascade + manual vec cleanup).
 */
export async function moveDocumentAcrossScopes(
  params: MoveDocumentParams,
): Promise<{ documentId: string; filename: string; fromPath: string; toPath: string }> {
  const src = await openKnowledgeDb(params.dataDir, params.fromScope, params.workspaceRoot, params.sessionId);
  if (!src) throw new MoveError(`source scope "${params.fromScope}" not available`, 400);
  const dst = await openKnowledgeDb(params.dataDir, params.toScope, params.workspaceRoot, params.sessionId);
  if (!dst) throw new MoveError(`target scope "${params.toScope}" not available`, 400);

  const doc = src.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, params.documentId))
    .get();
  if (!doc) throw new MoveError("Document not found in source scope", 404);

  // filename + scope is unique per DB; reject a move into a DB that has it
  const existing = dst.db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.filename, doc.filename))
    .get();
  if (existing) throw new MoveError("target already exists", 409);

  const dstKnowledgeDir = resolveKnowledgeDir(params.dataDir, params.toScope, params.workspaceRoot, params.sessionId);
  if (!dstKnowledgeDir) throw new MoveError(`target scope "${params.toScope}" not available`, 400);
  const toFile = join(dstKnowledgeDir, "sources", doc.filename);
  const fromFile = doc.filepath;
  if (fromFile && existsSync(fromFile) && fromFile !== toFile) {
    await mkdir(dirname(toFile), { recursive: true });
    await rename(fromFile, toFile);
  }

  // Cross-DB copy preserving ids. Unqualified table names refer to the source
  // (main) DB; `tgt.` rows go to the target DB. The target FTS trigger fires on
  // chunk insert, so knowledge_fts stays in sync automatically.
  src.sqlite.run(`ATTACH DATABASE ? AS tgt`, dst.path);
  try {
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_documents
         (id, filename, filepath, title, topics, summary, content_type, file_hash, file_size, status, created_by, scope, tags, chunk_count, created_at, updated_at)
       SELECT id, filename, ?, title, topics, summary, content_type, file_hash, file_size, status, created_by, ?, tags, chunk_count, created_at, updated_at
       FROM knowledge_documents WHERE id = ?`,
      toFile,
      params.toScope,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_chunks
         (id, document_id, content, section, chunk_index, token_count, hash, embedding_model, created_at)
       SELECT id, document_id, content, section, chunk_index, token_count, hash, embedding_model, created_at
       FROM knowledge_chunks WHERE document_id = ?`,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_embeddings (chunk_id, embedding)
       SELECT chunk_id, embedding FROM knowledge_embeddings
       WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)`,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_embedding_cache (id, chunk_hash, model, dimensions, created_at)
       SELECT id, chunk_hash, model, dimensions, created_at FROM knowledge_embedding_cache
       WHERE chunk_hash IN (SELECT hash FROM knowledge_chunks WHERE document_id = ?)`,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_embedding_meta (id, chunk_hash, model, dimensions, token_count, created_at)
       SELECT id, chunk_hash, model, dimensions, token_count, created_at FROM knowledge_embedding_meta
       WHERE chunk_hash IN (SELECT hash FROM knowledge_chunks WHERE document_id = ?)`,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_document_versions (id, document_id, version_number, content, file_hash, file_size, created_at)
       SELECT id, document_id, version_number, content, file_hash, file_size, created_at FROM knowledge_document_versions WHERE document_id = ?`,
      params.documentId,
    );
    src.sqlite.run(
      `INSERT INTO tgt.knowledge_relationships (id, source_document_id, target_document_id, relation_type, weight, created_at)
       SELECT id, source_document_id, target_document_id, relation_type, weight, created_at FROM knowledge_relationships
       WHERE source_document_id = ? OR target_document_id = ?`,
      params.documentId,
      params.documentId,
    );
  } finally {
    src.sqlite.run(`DETACH DATABASE tgt`);
  }

  // Remove from source (mirror deleteDocument cleanup; file already moved).
  await src.db
    .delete(knowledgeRelationships)
    .where(
      or(
        eq(knowledgeRelationships.sourceDocumentId, params.documentId),
        eq(knowledgeRelationships.targetDocumentId, params.documentId),
      ),
    );
  await src.db
    .delete(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, params.documentId));
  const chunks = src.db
    .select({ id: knowledgeChunks.id, hash: knowledgeChunks.hash })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.documentId, params.documentId))
    .all();
  deleteDocumentEmbeddings(
    src.sqlite,
    chunks.map((c) => c.id),
    chunks.map((c) => c.hash),
  );
  await src.db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, params.documentId));
  await src.db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, params.documentId));

  return { documentId: doc.id, filename: doc.filename, fromPath: fromFile, toPath: toFile };
}
