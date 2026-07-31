import type { SearchResult, FusionWeights } from "./types";
import { DEFAULT_FUSION_WEIGHTS } from "./types";

/**
 * Fuse vector and keyword results using weighted scoring.
 *
 * Algorithm:
 * 1. Normalize vector scores to [0,1]: score = 1 / (1 + distance)
 * 2. Normalize keyword scores to [0,1] via min-max over the result set (using .score)
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

  // Normalize keyword scores via min-max (using .score which is positive: higher = better)
  let keywordMax = 0;
  let keywordMin = Infinity;
  for (const r of keywordResults) {
    if (r.score !== undefined && r.score !== null) {
      if (r.score > keywordMax) keywordMax = r.score;
      if (r.score < keywordMin) keywordMin = r.score;
    }
  }
  // Single result or all-equal scores: everything is the best match → normalize to 1
  const keywordRange = keywordMax - keywordMin || 1;

  // Add vector results
  for (const r of vectorResults) {
    map.set(r.chunkId, {
      ...r,
      score: weights.vector * r.score, // score already normalized
    });
  }

  // Add/merge keyword results
  const allEqual = keywordMax === keywordMin;
  for (const r of keywordResults) {
    const normKeywordScore =
      r.score !== undefined && r.score !== null
        ? allEqual
          ? 1
          : (r.score - keywordMin) / keywordRange
        : 0;
    const existing = map.get(r.chunkId);
    if (existing) {
      existing.score += weights.keyword * normKeywordScore;
    } else {
      map.set(r.chunkId, {
        ...r,
        score: weights.keyword * normKeywordScore,
      });
    }
  }

  // Apply metadata boost exactly once per result (vector-only, keyword-only, or both)
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
