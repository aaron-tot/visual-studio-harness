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
}

export interface DocumentContent {
  id: string;
  filename: string;
  title: string;
  content: string;
  contentTruncated?: boolean;
}

export interface Chunk {
  content: string;
  section: string;
  chunkIndex: number;
  tokenCount: number;
  hash: string;
}

export interface ExtractedMetadata {
  title: string;
  topics: string[];
  summary: string;
}

export interface IngestResult {
  added: number;
  updated: number;
  deleted: number;
  failed: { filename: string; error: string }[];
}

export interface CreateDocumentInput {
  filename: string;
  content: string;
  tags?: string[];
  createdBy?: string;
}

export interface DeleteResult {
  ok: boolean;
  deleted: boolean;
  documentId: string;
}

export interface SearchFilters {
  tags?: string[];
  extension?: string;
  filename?: string;
  status?: string;
}

export type { KbScope };
