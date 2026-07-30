import type { KbScope } from "./db";

export interface DocumentMeta {
  id: string;
  filename: string;
  filepath: string;
  title: string;
  topics: string[];
  summary: string;
  contentType: string;
  fileHash: string;
  fileSize: number;
  status: string;
  createdBy: string;
  scope: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  /** Not from DB — computed field */
  extension?: string;
}

export interface DocumentContent {
  id: string;
  filename: string;
  title: string;
  content: string;
  contentTruncated?: boolean;
}

export interface IngestResult {
  added: number;
  updated: number;
  deleted: number;
  failed: Array<{ filename: string; error: string }>;
}

export interface CreateDocumentInput {
  filename: string;
  content: string;
  tags?: string[];
  scope?: string;
  createdBy?: string;
}

export interface DeleteResult {
  ok: boolean;
  deleted?: boolean;
  documentId?: string;
  error?: string;
}

export interface ChunkResult {
  content: string;
  section: string;
  chunkIndex: number;
  tokenCount: number;
  hash: string;
}

export interface MetadataResult {
  title: string;
  topics: string[];
  summary: string;
}

export interface JobRecord {
  id: string;
  type: string;
  status: string;
  scope: string;
  payload: unknown;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export interface VersionRecord {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  fileHash: string;
  fileSize: number;
  createdAt: string;
}
