import { clipLine, formatNumberedLines } from "../format";

/**
 * Fuzzy matching for the edit / apply_patch failure path.
 * Suggestion-only: callers must never auto-apply these matches.
 */

export const DEFAULT_MIN_SIMILARITY = 0.7;
export const AMBIGUITY_DELTA = 0.05;
export const MAX_SUGGESTION_LINES = 20;

/** Character-level fallback bounds (minified / short files). */
export const CHAR_FALLBACK_MAX_FILE = 50_000;
export const CHAR_FALLBACK_MAX_NEEDLE = 4_000;

const MIN_SIMILARITY_ENV = process.env.VISUAL_STUDIO_HARNESS_FUZZY_MIN_SIMILARITY;
export const FUZZY_MIN_SIMILARITY = MIN_SIMILARITY_ENV
  ? Number(MIN_SIMILARITY_ENV) || DEFAULT_MIN_SIMILARITY
  : DEFAULT_MIN_SIMILARITY;

/** Per-line char comparison cap when scoring. */
const SCORE_LINE_MAX_CHARS = 200;
/** Extra window sizes (lines) tolerated around the old_string line count. */
const WINDOW_DELTA = 3;
/** Minimum char similarity when no exact lines match (prevents "return X" ~ "return Y" false positives). */
const MIN_CHAR_SIM_NO_EXACT = 0.85;
/** Above this file size the char fallback uses a stride. */
const CHAR_FALLBACK_STRIDE_ABOVE = 8_000;
/** Line-length cap in the suggestion text (keeps tool errors bounded). */
const SUGGESTION_LINE_MAX_CHARS = 200;

export interface ClosestMatch {
  lineStart1Based: number;
  lineEnd1Based: number;
  score: number;
  actualLines: string[];
  ambiguous: boolean;
}

/** 0..1: identical → 1, otherwise shared prefix+suffix over the longer side. */
export function charSimilarity(a: string, b: string): number {
  const sa = a.slice(0, SCORE_LINE_MAX_CHARS);
  const sb = b.slice(0, SCORE_LINE_MAX_CHARS);
  if (sa === sb) return 1;
  const max = Math.min(sa.length, sb.length);
  let prefix = 0;
  while (prefix < max && sa[prefix] === sb[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && sa[sa.length - 1 - suffix] === sb[sb.length - 1 - suffix]) suffix++;
  return (prefix + suffix) / Math.max(sa.length, sb.length, 1);
}

function isTrivialLine(line: string): boolean {
  return line.trim() === "";
}

/** Score a window with one optional insertion/deletion (handles extra/missing blank line). */
function scoreWindow(oldLines: string[], windowLines: string[]): number {
  // Only allow skip when lengths differ by at most 1 (single blank line insertion/deletion)
  const lenDiff = Math.abs(oldLines.length - windowLines.length);
  const allowSkip = lenDiff <= 1;

  // Base alignment
  const base = scoreAligned(oldLines, windowLines);
  if (base >= 0.95) return base; // early exit for near-perfect
  if (!allowSkip) return base;

  let best = base;

  // Try skipping one line in oldLines (old has extra line) - only if skipped line is trivial
  if (oldLines.length > windowLines.length) {
    for (let skip = 0; skip < oldLines.length; skip++) {
      if (!isTrivialLine(oldLines[skip])) continue;
      const shortened = oldLines.slice(0, skip).concat(oldLines.slice(skip + 1));
      const score = scoreAligned(shortened, windowLines);
      if (score > best) best = score;
    }
  }

  // Try skipping one line in windowLines (window has extra line) - only if skipped line is trivial
  if (windowLines.length > oldLines.length) {
    for (let skip = 0; skip < windowLines.length; skip++) {
      if (!isTrivialLine(windowLines[skip])) continue;
      const shortened = windowLines.slice(0, skip).concat(windowLines.slice(skip + 1));
      const score = scoreAligned(oldLines, shortened);
      if (score > best) best = score;
    }
  }

  return best;
}

/** Score two line arrays aligned 1:1 (no insertions/deletions). */
function scoreAligned(a: string[], b: string[]): number {
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen === 0) return 0;

  let equal = 0;
  let charSum = 0;
  for (let i = 0; i < minLen; i++) {
    const sa = a[i].trim();
    const sb = b[i].trim();
    if (sa === sb) equal++;
    charSum += charSimilarity(sa, sb);
  }
  const avgChar = charSum / minLen;

  // Gate: require at least one exact trimmed-line match OR very high char similarity
  if (equal === 0 && avgChar < MIN_CHAR_SIM_NO_EXACT) return 0;

  // Score = (exact matches + similar non-matches) / maxLen
  // Each exact line: 1, each similar non-match: avgChar, each extra line in longer: 0
  return (equal + (minLen - equal) * avgChar) / maxLen;
}

interface WindowBest {
  start: number;
  size: number;
  score: number;
}

/** Best score at a single start across the ±WINDOW_DELTA size tolerance. */
function bestAtStart(
  oldLines: string[],
  fileLines: string[],
  start: number,
  needleLen: number
): { size: number; score: number } | null {
  let best: { size: number; score: number } | null = null;
  for (let delta = -WINDOW_DELTA; delta <= WINDOW_DELTA; delta++) {
    const size = needleLen + delta;
    if (size < 1 || start + size > fileLines.length) continue;
    const score = scoreWindow(oldLines, fileLines.slice(start, start + size));
    if (best === null || score > best.score) best = { size, score };
  }
  return best;
}

/** Sliding line-window scan; second pass finds the best non-overlapping alternative. */
function scanLineWindows(oldLines: string[], fileLines: string[]): { start: number; size: number; score: number; secondScore: number | null } | null {
  const needleLen = oldLines.length;

  let best: WindowBest | null = null;
  for (let start = 0; start < fileLines.length; start++) {
    const atStart = bestAtStart(oldLines, fileLines, start, needleLen);
    if (atStart && (best === null || atStart.score > best.score)) {
      best = { start, size: atStart.size, score: atStart.score };
    }
  }
  if (best === null) return null;

  let secondScore: number | null = null;
  for (let start = 0; start < fileLines.length; start++) {
    if (start === best.start) continue;
    const atStart = bestAtStart(oldLines, fileLines, start, needleLen);
    if (!atStart) continue;
    // Non-overlapping
    if (start < best.start + best.size && best.start < start + atStart.size) continue;
    if (secondScore === null || atStart.score > secondScore) {
      secondScore = atStart.score;
    }
  }

  return { ...best, secondScore };
}

/** Character-level scan for minified / single-line files; strided above a size cap. */
function scanCharacters(
  fileText: string,
  oldString: string
): { pos: number; score: number; secondScore: number | null } | null {
  if (fileText.length > CHAR_FALLBACK_MAX_FILE || oldString.length > CHAR_FALLBACK_MAX_NEEDLE) return null;
  if (fileText.length === 0) return null;
  const stride =
    fileText.length > CHAR_FALLBACK_STRIDE_ABOVE ? Math.max(1, Math.floor(oldString.length / 4)) : 1;

  let bestPos = -1;
  let bestScore = -1;
  for (let pos = 0; pos < fileText.length; pos += stride) {
    const score = charSimilarity(oldString, fileText.slice(pos, pos + oldString.length));
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  if (bestPos < 0) return null;

  let secondScore: number | null = null;
  for (let pos = 0; pos < fileText.length; pos += stride) {
    if (Math.abs(pos - bestPos) < oldString.length) continue;
    const score = charSimilarity(oldString, fileText.slice(pos, pos + oldString.length));
    if (secondScore === null || score > secondScore) secondScore = score;
  }

  return { pos: bestPos, score: bestScore, secondScore };
}

/**
 * Find the closest block to `oldString` in `fileText`.
 * Returns null when nothing clears the similarity threshold.
 */
export function findClosestMatch(
  fileText: string,
  oldString: string,
  options?: { minSimilarity?: number; ambiguityDelta?: number }
): ClosestMatch | null {
  const minSimilarity = options?.minSimilarity ?? FUZZY_MIN_SIMILARITY;
  const ambiguityDelta = options?.ambiguityDelta ?? AMBIGUITY_DELTA;

  if (oldString.length === 0 || fileText.length === 0) return null;

  const oldLines = oldString.split("\n");
  const fileLines = fileText.endsWith("\n") ? fileText.split("\n").slice(0, -1) : fileText.split("\n");

  if (fileLines.length >= 2 && fileLines.length >= oldLines.length - WINDOW_DELTA) {
    const best = scanLineWindows(oldLines, fileLines);
    if (!best || best.score < minSimilarity) return null;
    return {
      lineStart1Based: best.start + 1,
      lineEnd1Based: best.start + best.size,
      score: best.score,
      actualLines: fileLines.slice(best.start, best.start + best.size),
      ambiguous: best.secondScore !== null && best.score - best.secondScore < ambiguityDelta,
    };
  }

  const chars = scanCharacters(fileText, oldString);
  if (!chars || chars.score < minSimilarity) return null;
  const lineStart1Based = fileText.slice(0, chars.pos).split("\n").length;
  const matchedLines = fileText.slice(chars.pos, chars.pos + oldString.length).split("\n");
  return {
    lineStart1Based,
    lineEnd1Based: lineStart1Based + matchedLines.length - 1,
    score: chars.score,
    actualLines: matchedLines,
    ambiguous: chars.secondScore !== null && chars.score - chars.secondScore < ambiguityDelta,
  };
}

/** Human-readable suggestion appended to the tool error message. */
export function formatSuggestion(
  closest: ClosestMatch,
  oldString: string,
  maxLines: number = MAX_SUGGESTION_LINES
): string {
  const actual = closest.actualLines.slice(0, maxLines);
  const old = oldString.split("\n").slice(0, maxLines);

  const diff: string[] = [];
  const pairs = Math.min(actual.length, old.length);
  for (let i = 0; i < pairs; i++) {
    if (old[i] !== actual[i]) {
      diff.push(`- ${clipLine(old[i], SUGGESTION_LINE_MAX_CHARS)}`);
      diff.push(`+ ${clipLine(actual[i], SUGGESTION_LINE_MAX_CHARS)}`);
    }
  }

  const parts = [
    `Closest match at lines ${closest.lineStart1Based}-${closest.lineEnd1Based} (similarity ${closest.score.toFixed(2)}):`,
    formatNumberedLines(actual, closest.lineStart1Based, SUGGESTION_LINE_MAX_CHARS),
  ];
  if (diff.length > 0) {
    parts.push(`Diff (old_string vs file):\n${diff.slice(0, maxLines * 2).join("\n")}`);
  }
  if (closest.actualLines.length > maxLines) {
    parts.push(`(suggestion truncated; ${closest.actualLines.length - maxLines} more line(s))`);
  }
  parts.push("Re-issue the tool call using the exact text above as old_string.");
  return parts.join("\n");
}
