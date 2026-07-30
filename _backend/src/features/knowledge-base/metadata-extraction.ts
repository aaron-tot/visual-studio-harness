import type { MetadataResult } from "./types";

/**
 * Extract metadata (title, topics, summary) from a document.
 * Simple heuristic-based extraction — no external NLP dependency.
 * Extends for future LLM-based extraction.
 */
export function extractMetadata(filename: string, content: string): MetadataResult {
  const title = extractTitle(filename, content);
  const topics = extractTopics(content);
  const summary = extractSummary(content);
  return { title, topics, summary };
}

function extractTitle(filename: string, content: string): string {
  // If markdown: use first # heading
  if (filename.endsWith(".md")) {
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) return headingMatch[1].trim();
  }
  // Fall back to filename without extension
  const name = filename.replace(/\.[^.]+$/, "");
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTopics(content: string): string[] {
  const topics: string[] = [];
  const wordCounts = new Map<string, number>();

  // Strip markdown and code blocks
  const text = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase();

  // Count significant words (3+ chars)
  const words = text.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }

  // Extract top keywords (up to 5, appearing 2+ times)
  const sorted = [...wordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return sorted.map(([word]) => word);
}

function extractSummary(content: string): string {
  // Use first paragraph of meaningful content
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (p.startsWith("#")) return false;
      if (p.startsWith("```")) return false;
      if (p.startsWith("|")) return false; // tables
      return p.length > 40;
    });

  if (paragraphs.length === 0) return "";
  const first = paragraphs[0]
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > 200 ? first.slice(0, 197) + "..." : first;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "been", "some", "same",
  "into", "than", "that", "this", "with", "from", "they", "been", "their",
  "will", "when", "what", "which", "also", "its", "just", "like", "more",
  "much", "only", "over", "such", "them", "then", "very", "way", "well",
]);
