import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { KnowledgeBaseConfig, ProviderConfig } from "../../../../_shared/types/config";
import { openKnowledgeDb, closeAllKnowledgeDbs, resolveKnowledgeDir, type KbScope } from "./db";
import { resolveDimension } from "./sqlite/vec";
import { startWatcher } from "./ingestion/watcher";
import { runIngestion } from "./ingestion/pipeline";
import { searchKnowledge } from "./search";
import type { SearchFilters, SearchResult } from "./search/types";
import { listDocuments, openDocument } from "./service-queries";
import { createDocument, editDocument, deleteDocument } from "./service-mutations";
import type { DocumentMeta, DocumentContent, IngestResult, CreateDocumentInput, DeleteResult } from "./types";

export class KnowledgeBaseService {
  private readonly dataDir: string;
  private initialized = false;
  private config: KnowledgeBaseConfig | null = null;
  private providers: ProviderConfig[] = [];

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(config: KnowledgeBaseConfig | undefined, providers?: ProviderConfig[]): Promise<void> {
    if (!config?.enabled) {
      console.log("[knowledge] disabled by config");
      return;
    }

    console.log("[knowledge] initializing...");
    this.config = config;
    if (providers) this.providers = providers;

    // Only init global scope at startup — project/session are lazy (need workspaceRoot/sessionId)
    const globalDir = resolveKnowledgeDir(this.dataDir, "global");
    if (globalDir) {
      const sourcesDir = join(globalDir, "sources");
      await mkdir(sourcesDir, { recursive: true });
      const dimension = resolveDimension(config.embedding.model);
      const kbDb = await openKnowledgeDb(this.dataDir, "global", undefined, undefined, dimension);
      if (kbDb) {
        console.log(`[knowledge] global DB ready at ${kbDb.path} (dimension: ${dimension})`);
      }
    }

    this.initialized = true;
    console.log("[knowledge] initialized");
  }

  async destroy(): Promise<void> {
    if (!this.initialized) return;
    closeAllKnowledgeDbs();
    this.initialized = false;
    console.log("[knowledge] destroyed");
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get baseDataDir(): string {
    return this.dataDir;
  }

  // ── Search ────────────────────────────────────────────────────────

  async search(
    scope: KbScope,
    query: string,
    opts?: { limit?: number; mode?: string; filters?: SearchFilters },
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<{ results: SearchResult[]; hybrid: boolean }> {
    if (!this.config) return { results: [], hybrid: false };
    const { results, hybrid } = await searchKnowledge(
      this.dataDir,
      scope,
      query,
      opts || {},
      this.config,
      this.providers,
      workspaceRoot,
      sessionId,
    );
    return { results, hybrid };
  }

  async openDocument(
    scope: KbScope,
    id: string,
    maxChars?: number,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentContent | null> {
    return openDocument(this.dataDir, scope, id, maxChars, workspaceRoot, sessionId);
  }

  async listDocuments(
    scope: KbScope,
    filters?: { tags?: string[]; extension?: string; status?: string; createdBy?: string },
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta[]> {
    return listDocuments(this.dataDir, scope, filters, workspaceRoot, sessionId);
  }

  async ingest(
    scope: KbScope,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<IngestResult> {
    if (!this.config) return { added: 0, updated: 0, deleted: 0, failed: [] };
    const db = await openKnowledgeDb(this.dataDir, scope, workspaceRoot, sessionId);
    if (!db) return { added: 0, updated: 0, deleted: 0, failed: [] };
    return runIngestion(this.dataDir, scope, db, this.config, workspaceRoot, sessionId);
  }

  async createDocument(
    scope: KbScope,
    input: CreateDocumentInput,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta> {
    return createDocument(this.dataDir, scope, input, workspaceRoot, sessionId);
  }

  async editDocument(
    scope: KbScope,
    id: string,
    content: string,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta> {
    return editDocument(this.dataDir, scope, id, content, workspaceRoot, sessionId);
  }

  async deleteDocument(
    scope: KbScope,
    id: string,
    confirmed: boolean,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DeleteResult> {
    return deleteDocument(this.dataDir, scope, id, confirmed, workspaceRoot, sessionId);
  }
}
