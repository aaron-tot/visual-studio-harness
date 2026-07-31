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
): Promise<{ results: SearchResult[]; hybrid: boolean; total: number }> {
  const db = await openKnowledgeDb(dataDir, scope, workspaceRoot, sessionId);
  if (!db) return { results: [], hybrid: false, total: 0 };

  const mode = opts.mode || "general";
  const preset = MODE_PRESETS[mode] || MODE_PRESETS.general;
  // Mode presets define the default chunk count; an explicit limit overrides it.
  const topK = opts.limit ?? preset.topK;
  const weights = preset.weights;

  // Gather a wider candidate set from each channel so `total` reflects matches
  // before top-K truncation. Bounded to keep queries cheap.
  const MAX_CANDIDATES = 200;
  const candidateK = Math.max(topK, MAX_CANDIDATES);

  let vectorResults: SearchResult[] = [];
  let vectorRan = false;

  // Vector search is mandatory when embeddings are configured: a failure here
  // must surface, never silently degrade to keyword-only results.
  if (config.embedding.providerId) {
    const provider = await resolveEmbeddingProvider(config.embedding.providerId, providers || [], config.embedding.model);
    if (provider) {
      const embeddings = await provider.embed([query], config.embedding.model);
      if (embeddings.length > 0) {
        const queryEmbedding = new Float32Array(embeddings[0]);
        vectorRan = true;
        vectorResults = await vectorSearch(db.sqlite, queryEmbedding, opts.filters, candidateK);
      }
    }
  }

  // Always run keyword search
  const kwResults = await keywordSearch(db.sqlite, query, opts.filters, candidateK);

  // hybrid = true when both channels RAN (keyword always runs). Not gated on
  // whether either returned results — an empty channel is a valid outcome.
  const hybrid = vectorRan;

  const results = fuseResults(vectorResults, kwResults, weights, topK);

  // Total distinct matches across both channels before top-K truncation.
  const total = new Set([...vectorResults, ...kwResults].map((r) => r.chunkId)).size;

  return { results, hybrid, total };
}
