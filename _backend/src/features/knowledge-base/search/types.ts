export interface SearchResult {
  chunkId: string;
  documentId: string;
  filename: string;
  section: string;
  content: string;
  score: number;
  distance?: number;
  rank?: number;
}

export interface SearchFilters {
  tags?: string[];
  filename?: string;
  extension?: string;
  createdAfter?: string;
  createdBefore?: string;
  createdBy?: string;
}

export interface SearchOptions {
  limit?: number;
  mode?: string;
  filters?: SearchFilters;
}

export interface FusionWeights {
  vector: number;
  keyword: number;
  metadata: number;
}

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  vector: 0.6,
  keyword: 0.3,
  metadata: 0.1,
};

export const MODE_PRESETS: Record<string, { topK: number; weights: FusionWeights }> = {
  general: { topK: 10, weights: { vector: 0.6, keyword: 0.3, metadata: 0.1 } },
  code: { topK: 15, weights: { vector: 0.3, keyword: 0.6, metadata: 0.1 } },
  research: { topK: 20, weights: { vector: 0.8, keyword: 0.1, metadata: 0.1 } },
  documentation: { topK: 10, weights: { vector: 0.4, keyword: 0.3, metadata: 0.3 } },
};
