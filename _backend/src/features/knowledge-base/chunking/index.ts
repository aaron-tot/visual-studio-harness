import { createHash } from "node:crypto";
import type { Chunk } from "./types";

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const FENCE_RE = /```[\s\S]*?```/g;
const TABLE_ROW_RE = /^\|.+\|$/m;

/**
 * Split a markdown document into section-aware chunks.
 * Never splits inside code fences or markdown tables.
 */
export function chunkDocument(filename: string, content: string): Chunk[] {
  if (filename.endsWith(".md") || filename.endsWith(".markdown")) {
    return chunkMarkdown(content);
  }
  // Plain text: single chunk
  return [makeChunk(content, "Document", 0)];
}

function chunkMarkdown(content: string): Chunk[] {
  const fences = extractProtectedRanges(content, FENCE_RE);
  const tables = extractProtectedRanges(content, TABLE_ROW_RE);

  const protectedRanges = mergeRanges([...fences, ...tables]);

  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentSection = "Document";
  let currentLines: string[] = [];
  const sections: string[] = [];

  for (const line of lines) {
    const heading = isHeading(line, protectedRanges, content);
    if (heading) {
      // Flush current chunk
      if (currentLines.length > 0) {
        chunks.push(makeChunk(currentLines.join("\n"), currentSection, chunks.length));
        currentLines = [];
      }

      // Update section breadcrumb
      sections.length = heading.depth - 1;
      for (let i = sections.length; i < heading.depth - 1; i++) sections[i] = "";
      sections[heading.depth - 1] = heading.text;
      currentSection = sections.filter(Boolean).join(" > ");
      continue;
    }

    currentLines.push(line);
  }

  // Flush last chunk
  if (currentLines.length > 0) {
    chunks.push(makeChunk(currentLines.join("\n"), currentSection, chunks.length));
  }

  // If no chunks produced (empty content), produce one empty chunk
  if (chunks.length === 0) {
    chunks.push(makeChunk("", currentSection, 0));
  }

  return chunks;
}

function makeChunk(content: string, section: string, chunkIndex: number): Chunk {
  const trimmed = content.trim();
  const hash = createHash("sha256").update(trimmed).digest("hex");
  return {
    content: trimmed,
    section,
    chunkIndex,
    tokenCount: Math.max(1, Math.round(trimmed.length / 4)),
    hash,
  };
}

function isHeading(
  line: string,
  protectedRanges: { start: number; end: number }[],
  fullContent: string,
): { depth: number; text: string } | null {
  const trimmed = line.trim();
  const m = trimmed.match(/^(#{1,6})\s+(.+)/);
  if (!m) return null;

  // Check if this line is inside a protected range (code fence / table)
  // by computing its approximate offset in the content
  const lineIdx = fullContent.split("\n").indexOf(line);
  if (lineIdx < 0) return null;

  let offset = 0;
  const lines = fullContent.split("\n");
  for (let i = 0; i < lineIdx; i++) {
    offset += lines[i].length + 1;
  }

  for (const r of protectedRanges) {
    if (offset >= r.start && offset <= r.end) return null;
  }

  return { depth: m[1].length, text: m[2].trim() };
}

function extractProtectedRanges(
  content: string,
  regex: RegExp,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(content)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function mergeRanges(
  ranges: { start: number; end: number }[],
): { start: number; end: number }[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}
