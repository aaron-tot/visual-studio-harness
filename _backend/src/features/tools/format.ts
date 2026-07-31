export const DEFAULT_READ_MAX_LINES = 2000;
export const DEFAULT_MAX_LINE_LENGTH = 2000;
export const DEFAULT_BASH_MAX_BYTES = 64 * 1024;
export const DEFAULT_GREP_MAX_MATCHES = 100;

export function clipLine(line: string, maxLen = DEFAULT_MAX_LINE_LENGTH): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen) + "...";
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return { text, truncated: false };
  // cut on byte boundary carefully
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return {
    text: buf.slice(0, end).toString("utf-8") + "\n\n(Output truncated due to length limit)",
    truncated: true,
  };
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + needle.length;
  }
  return count;
}

/** 1-based line numbers, cat -n style */
export function formatNumberedLines(
  lines: string[],
  startLine1Based: number,
  maxLineLength = DEFAULT_MAX_LINE_LENGTH
): string {
  return lines
    .map((line, i) => {
      const n = (startLine1Based + i).toString().padStart(5, "0");
      return `${n}| ${clipLine(line, maxLineLength)}`;
    })
    .join("\n");
}
