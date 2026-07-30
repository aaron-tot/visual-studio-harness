import { openKnowledgeDb, type KbScope } from "../db";
import type { KnowledgeBaseConfig, ProviderConfig } from "../../../../../_shared/types/config";
import { vectorSearch } from "./vector";
import { keywordSearch } from "./keyword";
import { fuseResults } from "./fusion";
import type { SearchResult, SearchOptions } from "./types";
import { MODE_PRESETS } from "./types";
import { resolveEmbeddingProvider } from "../embedding/resolve";

/**
 * Hybrid search orchestrator.
 *
 * 1. Resolve scope DB
 * 2. If embedding provider available AND vec0 table exists → run vector search
 * 3. Always run keyword search (FTS5 is always available)
 * 4. Fuse results
 * 5. Return results + hybrid flag
 */
export async function searchKnowledge(
  dataDir: string,
  scope: KbScope,
  query: string,
  opts: SearchOptions,
  config: KnowledgeBaseConfig,
  providers?: ProviderConfig[],
  workspaceRoot?: string,
  sessionId?: string,
): Promise<{ results: SearchResult[]; hybrid: boolean }> {
  const db = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!db) return { results: [], hybrid: false };

  const mode = opts.mode || "general";
  const preset = MODE_PRESETS[mode] || MODE_PRESETS.general;
  const topK = opts.limit || preset.topK;
  const weights = {
    vector: config.search.vectorWeight,
    keyword: config.search.keywordWeight,
    metadata: config.search.metadataWeight,
  };

  let vectorResults: SearchResult[] = [];
  let hybrid = false;

  // Try vector search if embedding provider is available
  if (config.embedding.providerId && providers) {
    try {
      const provider = await resolveEmbeddingProvider(config.embedding.providerId, providers);

      if (provider) {
        const embeddings = await provider.embed([query], config.embedding.model);
        if (embeddings.length > 0) {
          const queryEmbedding = new Float32Array(embeddings[0]);
          vectorResults = await vectorSearch(db.sqlite, queryEmbedding, opts.filters, topK);
        }
      }
    } catch (err: any) {
      console.warn("[knowledge] Vector search error:", err.message);
    }
  }

  // Always run keyword search
  const kwResults = await keywordSearch(db.sqlite, query, opts.filters, topK);

  if (vectorResults.length > 0 && kwResults.length > 0) {
    hybrid = true;
  }

  const results = fuseResults(vectorResults, kwResults, weights, topK);

  return { results, hybrid };
}
