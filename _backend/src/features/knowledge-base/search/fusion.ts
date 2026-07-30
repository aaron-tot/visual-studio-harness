import type { SearchResult, FusionWeights } from "./types";
import { DEFAULT_FUSION_WEIGHTS } from "./types";

/**
 * Fuse vector and keyword results using weighted scoring.
 *
 * Algorithm:
 * 1. Normalize vector scores to [0,1]: score = 1 / (1 + distance)
 * 2. Normalize keyword scores to [0,1] via min-max over the result set
 * 3. Build dedup map by chunkId
 * 4. finalScore = vectorWeight * normVectorScore + keywordWeight * normKeywordScore
 * 5. finalScore += metadataWeight * metadataBoost
 * 6. Sort descending by finalScore, slice to topK
 */
export function fuseResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
  topK: number = 10,
): SearchResult[] {
  const map = new Map<string, SearchResult>();

  // Normalize keyword scores via min-max (only if we have results)
  let keywordMax = 0;
  let keywordMin = Infinity;
  for (const r of keywordResults) {
    if (r.rank !== undefined) {
      if (r.rank > keywordMax) keywordMax = r.rank;
      if (r.rank < keywordMin) keywordMin = r.rank;
    }
  }
  const keywordRange = keywordMax - keywordMin || 1;

  // Add vector results
  for (const r of vectorResults) {
    map.set(r.chunkId, {
      ...r,
      score: weights.vector * r.score, // score already normalized
    });
  }

  // Add/merge keyword results
  for (const r of keywordResults) {
    const normKeywordScore = r.rank !== undefined ? (r.rank - keywordMin) / keywordRange : 0;
    const existing = map.get(r.chunkId);
    if (existing) {
      existing.score += weights.keyword * normKeywordScore;
      existing.score += computeMetadataBoost(r) * weights.metadata;
    } else {
      map.set(r.chunkId, {
        ...r,
        score: weights.keyword * normKeywordScore + computeMetadataBoost(r) * weights.metadata,
      });
    }
  }

  // Apply metadata boost to vector-only results
  for (const [, r] of map) {
    r.score += computeMetadataBoost(r) * weights.metadata;
  }

  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function computeMetadataBoost(result: SearchResult): number {
  let boost = 0;
  // Boost for documents with a section (structured docs)
  if (result.section && result.section !== "Document") {
    boost += 0.05;
  }
  return boost;
}
