export type ResearchConfidence = "high" | "medium" | "low" | "speculative";

export interface ResearchPoint {
  id: string;
  question: string;
  answer: string;
  sourceUrl?: string;
  sourcePath?: string;
  verbatimQuotes: string[];
  summary: string;
  searchedAt: string; // ISO
  confidence: ResearchConfidence;
}

export interface ResearchDocMeta {
  id: string;
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface ResearchDoc {
  meta: ResearchDocMeta;
  goal: string;
  initialQueryPoints: ResearchPoint[];
  discoveredQueryPoints: ResearchPoint[];
}
