import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── Documents ──────────────────────────────────────────────────────

export const knowledgeDocuments = sqliteTable("knowledge_documents", {
  id: text("id").primaryKey(), // UUID v7
  filename: text("filename").notNull(),
  filepath: text("filepath").notNull().default(""),
  title: text("title").notNull().default(""),
  topics: text("topics").notNull().default(""), // JSON array of strings
  summary: text("summary").notNull().default(""),
  contentType: text("content_type").notNull().default("text"), // "markdown" | "text"
  fileHash: text("file_hash").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  status: text("status").notNull().default("ready"), // "ready" | "indexing" | "error"
  createdBy: text("created_by").notNull().default("user"), // "user" | "agent" | "system"
  scope: text("scope").notNull().default("global"), // "global" | "project" | "session"
  tags: text("tags").notNull().default("[]"), // JSON array
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  filenameScopeIdx: uniqueIndex("idx_docs_filename_scope").on(t.filename, t.scope),
  statusIdx: index("idx_docs_status").on(t.status),
  scopeIdx: index("idx_docs_scope").on(t.scope),
}));

// ── Chunks ─────────────────────────────────────────────────────────

export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: text("id").primaryKey(), // UUID v7
  documentId: text("document_id").notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  section: text("section").notNull().default("Document"),
  chunkIndex: integer("chunk_index").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  hash: text("hash").notNull(),
  embeddingModel: text("embedding_model"), // null = not yet embedded
  createdAt: text("created_at").notNull(),
}, (t) => ({
  documentIdx: index("idx_chunks_document_id").on(t.documentId),
  hashIdx: index("idx_chunks_hash").on(t.hash),
}));

// ── Embedding cache ────────────────────────────────────────────────

export const knowledgeEmbeddingCache = sqliteTable("knowledge_embedding_cache", {
  id: text("id").primaryKey(), // UUID v7
  chunkHash: text("chunk_hash").notNull(),
  model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  hashModelUq: uniqueIndex("idx_cache_hash_model").on(t.chunkHash, t.model),
}));

// ── Embedding meta ─────────────────────────────────────────────────

export const knowledgeEmbeddingMeta = sqliteTable("knowledge_embedding_meta", {
  id: text("id").primaryKey(), // UUID v7
  chunkHash: text("chunk_hash").notNull(),
  model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  hashModelUq: uniqueIndex("idx_meta_hash_model").on(t.chunkHash, t.model),
}));

// ── Relationships ──────────────────────────────────────────────────

export const knowledgeRelationships = sqliteTable("knowledge_relationships", {
  id: text("id").primaryKey(), // UUID v7
  sourceDocumentId: text("source_document_id").notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  targetDocumentId: text("target_document_id").notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull().default("related"), // "related" | "references" | "parent" | "child"
  weight: real("weight").notNull().default(1.0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  sourceIdx: index("idx_rels_source").on(t.sourceDocumentId),
  targetIdx: index("idx_rels_target").on(t.targetDocumentId),
}));

// ── Groups ─────────────────────────────────────────────────────────

export const knowledgeGroups = sqliteTable("knowledge_groups", {
  id: text("id").primaryKey(), // UUID v7
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  sortOrder: integer("sort_order").notNull().default(0),
  scope: text("scope").notNull().default("global"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  scopeSortIdx: index("idx_groups_scope_sort").on(t.scope, t.sortOrder),
}));

// ── Group Documents (junction) ─────────────────────────────────────

export const knowledgeGroupDocuments = sqliteTable("knowledge_group_documents", {
  id: text("id").primaryKey(), // UUID v7
  groupId: text("group_id").notNull()
    .references(() => knowledgeGroups.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  groupDocUq: uniqueIndex("idx_group_doc_uq").on(t.groupId, t.documentId),
  groupIdx: index("idx_group_docs_group").on(t.groupId),
  docIdx: index("idx_group_docs_document").on(t.documentId),
}));

// ── Jobs ───────────────────────────────────────────────────────────

export const knowledgeJobs = sqliteTable("knowledge_jobs", {
  id: text("id").primaryKey(), // UUID v7
  type: text("type").notNull(), // "embed" | "delete" | "reindex"
  status: text("status").notNull().default("queued"), // "queued" | "processing" | "completed" | "failed"
  scope: text("scope").notNull().default("global"),
  payload: text("payload").notNull().default("{}"), // JSON
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  statusIdx: index("idx_jobs_status").on(t.status),
  typeStatusIdx: index("idx_jobs_type_status").on(t.type, t.status),
}));

// ── Document Versions ──────────────────────────────────────────────

export const knowledgeDocumentVersions = sqliteTable("knowledge_document_versions", {
  id: text("id").primaryKey(), // UUID v7
  documentId: text("document_id").notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  content: text("content").notNull(),
  fileHash: text("file_hash").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  docVersionUq: uniqueIndex("idx_versions_doc_version").on(t.documentId, t.versionNumber),
  docIdx: index("idx_versions_document").on(t.documentId),
}));
