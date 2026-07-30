import type { ChunkResult } from "../types";

const DEFAULT_CHUNK_SIZE = 1024;
const DEFAULT_OVERLAP = 200;

/**
 * Chunk a document into sections-aware pieces.
 *
 * Algorithm:
 * 1. Split by markdown headings (##, ###, etc.) for structured docs
 * 2. For plain text, split by paragraphs then combine
 * 3. If any chunk exceeds chunkSize, split further by sentence boundary or size
 * 4. Overlap prevents context loss at boundaries
 */
export function chunkDocument(
  filename: string,
  content: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): ChunkResult[] {
  if (!content.trim()) return [];

  // Detect mode by extension or content
  const isMarkdown = filename.endsWith(".md") || filename.endsWith(".markdown");

  if (isMarkdown) {
    return chunkMarkdown(content, chunkSize, overlap);
  }
  return chunkPlainText(content, chunkSize, overlap);
}

function chunkMarkdown(content: string, chunkSize: number, overlap: number): ChunkResult[] {
  const lines = content.split("\n");
  const sections: Array<{ heading: string; content: string[] }> = [];
  let currentHeading = "Document";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines });
  }

  const chunks: ChunkResult[] = [];
  let chunkIndex = 0;
  let previousOverlap = "";

  for (const section of sections) {
    const sectionText = section.content.join("\n").trim();
    if (!sectionText) continue;

    const sectionChunks = splitText(sectionText, chunkSize, overlap);

    for (const chunkText of sectionChunks) {
      const combined = previousOverlap
        ? previousOverlap + "\n" + chunkText
        : chunkText;
      const contentStr = combined.trim();
      if (!contentStr) continue;

      chunks.push({
        content: contentStr,
        section: section.heading,
        chunkIndex: chunkIndex++,
        tokenCount: estimateTokens(contentStr),
        hash: simpleHash(contentStr),
      });

      // Store overlap for next chunk
      if (overlap > 0 && chunkText.length > overlap) {
        previousOverlap = chunkText.slice(-overlap);
      } else {
        previousOverlap = "";
      }
    }
  }

  return chunks;
}

function chunkPlainText(content: string, chunkSize: number, overlap: number): ChunkResult[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: ChunkResult[] = [];
  let chunkIndex = 0;
  let buffer = "";
  let previousOverlap = "";

  for (const para of paragraphs) {
    if ((buffer + "\n\n" + para).length > chunkSize && buffer) {
      const combined = previousOverlap
        ? previousOverlap + "\n" + buffer.trim()
        : buffer.trim();
      if (combined) {
        chunks.push({
          content: combined,
          section: "Document",
          chunkIndex: chunkIndex++,
          tokenCount: estimateTokens(combined),
          hash: simpleHash(combined),
        });
      }
      if (overlap > 0) {
        const lines = buffer.split("\n");
        const overlapLines: string[] = [];
        let overlapLen = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (overlapLen + lines[i].length > overlap) break;
          overlapLines.unshift(lines[i]);
          overlapLen += lines[i].length + 1;
        }
        previousOverlap = overlapLines.join("\n");
      } else {
        previousOverlap = "";
      }
      buffer = para;
    } else {
      buffer = buffer ? buffer + "\n\n" + para : para;
    }
  }

  if (buffer.trim()) {
    const finalContent = previousOverlap
      ? previousOverlap + "\n" + buffer.trim()
      : buffer.trim();
    chunks.push({
      content: finalContent,
      section: "Document",
      chunkIndex: chunkIndex++,
      tokenCount: estimateTokens(finalContent),
      hash: simpleHash(finalContent),
    });
  }

  return chunks;
}

function splitText(text: string, maxSize: number, _overlap: number): string[] {
  if (text.length <= maxSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxSize;

    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }

    // Try to break at sentence boundary
    const searchEnd = end;
    let breakPoint = text.lastIndexOf(". ", end);
    if (breakPoint > start && breakPoint < searchEnd) {
      end = breakPoint + 1;
    } else {
      // Try paragraph break
      breakPoint = text.lastIndexOf("\n\n", end);
      if (breakPoint > start && breakPoint < searchEnd) {
        end = breakPoint;
      } else {
        // Try newline
        breakPoint = text.lastIndexOf("\n", end);
        if (breakPoint > start && breakPoint < searchEnd) {
          end = breakPoint;
        } else {
          // Try word boundary
          breakPoint = text.lastIndexOf(" ", end);
          if (breakPoint > start) {
            end = breakPoint;
          }
          // else: hard cut at maxSize (edge case)
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks;
}

/**
 * Simple token count approximation: 4 chars ≈ 1 token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
