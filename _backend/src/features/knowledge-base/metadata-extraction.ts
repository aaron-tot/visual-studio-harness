import type { ExtractedMetadata } from "./types";

/**
 * Extract title, topics, and summary from file content.
 * No external deps — uses word frequency for topics.
 */
export function extractMetadata(filename: string, content: string): ExtractedMetadata {
  const title = extractTitle(filename, content);
  const topics = extractTopics(content);
  const summary = extractSummary(content);

  return { title, topics, summary };
}

function extractTitle(filename: string, content: string): string {
  // First h1 heading in markdown
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // First non-empty line for text files
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, 120);

  // Fallback to filename without extension
  return filename.replace(/\.[^.]+$/, "").replace(/^agentCreate_/, "");
}

function extractTopics(content: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "need",
    "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "we", "us", "our", "you", "your", "he", "she", "him", "her", "his",
    "not", "no", "nor", "so", "if", "then", "than", "too", "very", "just",
    "about", "above", "after", "again", "all", "also", "any", "because",
    "been", "before", "between", "both", "each", "few", "more", "most",
    "other", "some", "such", "only", "own", "same", "into", "over", "under",
    "up", "out", "off", "down", "here", "there", "when", "where", "why", "how",
    "what", "which", "who", "whom", "while", "during", "through", "without",
  ]);

  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

function extractSummary(content: string): string {
  // Remove headings, blank lines, take first 200 chars of real content
  const body = content
    .replace(/^#+\s+.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  return body.slice(0, 200).replace(/\s+/g, " ").trim();
}
