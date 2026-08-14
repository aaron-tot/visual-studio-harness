import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { FSWatcher } from "node:fs";
import type { KnowledgeBaseConfig, ProviderConfig } from "../../../../_shared/types/config";
import { openKnowledgeDb, closeAllKnowledgeDbs, resolveKnowledgeDir, type KbScope } from "./db";
import { resolveDimension } from "./sqlite/vec";
import { startWatcher } from "./ingestion/watcher";
import { runIngestion } from "./ingestion/pipeline";
import { searchKnowledge } from "./search";
import { EmbeddingQueue } from "./embedding/queue";
import { resolveEmbeddingProvider } from "./embedding/resolve";
import type { SearchFilters, SearchResult } from "./search/types";
import { listDocuments, openDocument, resolveDocumentByFilename } from "./service-queries";
import { createDocument, editDocument, deleteDocument } from "./service-mutations";
import { moveDocumentAcrossScopes } from "./service-move";
import type { MoveDocumentParams } from "./service-move";
import type { DocumentMeta, DocumentContent, IngestResult, CreateDocumentInput, DeleteResult } from "./types";

export class KnowledgeBaseService {
  readonly dataDir: string;
  private initialized = false;
  private config: KnowledgeBaseConfig | null = null;
  private providers: ProviderConfig[] = [];
  private watchers: FSWatcher[] = [];
  private embeddingQueue: EmbeddingQueue | null = null;

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

        // Resolve the embedding provider and start the background embedding queue.
        let provider: Awaited<ReturnType<typeof resolveEmbeddingProvider>> = null;
        try {
          provider = await resolveEmbeddingProvider(
            config.embedding.providerId,
            this.providers,
            config.embedding.model,
          );
        } catch (err: any) {
          // Config error — surface loudly. Search will re-resolve and throw a
          // clear error instead of silently degrading to keyword-only.
          console.error(`[knowledge] ${err.message}`);
        }
        this.embeddingQueue = new EmbeddingQueue(provider, config.embedding.batchSize);
        if (provider) {
          console.log(`[knowledge] embedding provider: ${provider.displayName} / ${provider.modelName} (${provider.dimensions} dims)`);
        }

        // Process any pending embed jobs from a previous run (async, non-blocking).
        (async () => {
          try {
            await this.embeddingQueue?.processPending(this.dataDir, "global");
          } catch (err: any) {
            console.warn("[knowledge] startup embed queue error:", err.message);
          }
        })();

        // Start file watcher for auto-ingestion on file changes
        const watcher = startWatcher(sourcesDir, async () => {
          try {
            await this.ingest("global");
          } catch (err: any) {
            console.error("[knowledge] watcher ingest error:", err.message);
          }
        });
        this.watchers.push(watcher);
        console.log("[knowledge] file watcher started on", sourcesDir);
      }
    }

    this.initialized = true;
    console.log("[knowledge] initialized");
  }

  async destroy(): Promise<void> {
    if (!this.initialized) return;
    for (const w of this.watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this.watchers = [];
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
  ): Promise<{ results: SearchResult[]; hybrid: boolean; total: number }> {
    if (!this.config) {
      throw new Error("Knowledge Base is not enabled in config — enable knowledge.enabled to search.");
    }
    const cfg = this.config;
    const { results, hybrid, total } = await searchKnowledge(
      this.dataDir,
      scope,
      query,
      opts || {},
      cfg,
      this.providers,
      workspaceRoot,
      sessionId,
    );
    return { results, hybrid, total };
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

  async resolveFilename(
    scope: KbScope,
    filename: string,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta | null> {
    return resolveDocumentByFilename(this.dataDir, scope, filename, workspaceRoot, sessionId);
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
    const result = await runIngestion(this.dataDir, scope, db, this.config, workspaceRoot, sessionId);

    // Generate embeddings for any newly-queued chunks (non-blocking; search
    // still works with keyword results while embeddings are in-flight).
    if (this.embeddingQueue) {
      (async () => {
        try {
          await this.embeddingQueue!.processPending(this.dataDir, scope);
        } catch (err: any) {
          console.warn("[knowledge] embed queue processing error:", err.message);
        }
      })();
    }

    return result;
  }

  async createDocument(
    scope: KbScope,
    input: CreateDocumentInput,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta> {
    const embeddingsEnabled = !!this.config?.embedding.providerId;
    return createDocument(this.dataDir, scope, input, workspaceRoot, sessionId, embeddingsEnabled);
  }

  async editDocument(
    scope: KbScope,
    id: string,
    content: string,
    workspaceRoot?: string,
    sessionId?: string,
  ): Promise<DocumentMeta> {
    const embeddingsEnabled = !!this.config?.embedding.providerId;
    return editDocument(this.dataDir, scope, id, content, workspaceRoot, sessionId, embeddingsEnabled);
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

  /** Move a document to another scope, preserving id, chunks, and embeddings. */
  async moveDocument(
    fromScope: KbScope,
    toScope: KbScope,
    documentId: string,
    workspaceRoot?: string,
    sessionId?: string,
  ) {
    return moveDocumentAcrossScopes({
      fromScope,
      toScope,
      documentId,
      dataDir: this.dataDir,
      workspaceRoot,
      sessionId,
    });
  }
}
