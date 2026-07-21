export type LinkType = "url" | "file" | "folder";

const URL_REGEX = /https?:\/\/(?:[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9a-fA-F]{2})+/g;

/**
 * Check if a token looks like a real filesystem path, not just any text with a slash.
 *
 * NOTE: This is a custom regex-based detector. If we find it has too many false
 * positives or misses real paths, consider switching to a combination of libs like:
 *   - linkify-it (URLs, 23M weekly downloads, handles fuzzy matching)
 *   - react-linkify-it (react wrapper for linkify-it, supports custom regex patterns)
 *   - link-harvester (classifies local vs external links in markdown)
 *   - text-categorizer (detects links, file paths, code, emails, etc.)
 * No single lib handles URLs + file paths + folders together, so a combo may be needed.
 */
export function isFilePath(s: string): boolean {
  if (s.length < 2) return false;
  if (/^https?:\/\//i.test(s) || /^[a-zA-Z]+:\/\//.test(s)) return false;
  if (s.startsWith("//")) return false;

  // Absolute paths: /home/user, C:\Users, \\server\share
  if (/^\/[\w.\-]/.test(s)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (/^\\\\/.test(s)) return true;

  // Relative paths: ./foo, ../foo, ~/foo
  if (/^\.\//.test(s) || /^\.\.[\\/]/.test(s) || /^~\//.test(s)) return true;

  // Relative folder: src/, dist/, build/ — word(s) ending with /
  if (/^[\w.\-]+\/$/.test(s)) return true;

  // Filename with extension: README.md, config.json
  if (/^[\w.\-]+\.[a-zA-Z0-9]{1,10}$/.test(s)) return true;

  return false;
}

export interface LinkResult {
  type: LinkType;
  value: string;
  start: number;
  end: number;
}

/**
 * Extract all links from text — URLs, file paths, and folder paths.
 *
 * NOTE: If this regex-based approach causes too many issues, consider using
 * linkify-it for URLs + a path detection lib for file/folder paths.
 * No single npm package handles all three cleanly, so a combo would be needed.
 */
export function extractLinks(text: string): LinkResult[] {
  const links: LinkResult[] = [];

  let m;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    links.push({ type: "url", value: m[0], start: m.index, end: m.index + m[0].length });
  }

  const TOKEN_RE = /\S+/g;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const token = m[0];
    const start = m.index;
    const end = start + token.length;

    const overlapsUrl = links.some(
      (l) => l.type === "url" && start < l.end && end > l.start,
    );
    if (overlapsUrl) continue;

    const clean = token.replace(/[.,;:!?)\]}>'"]+$/, "");
    if (clean.length < 2) continue;

    if (isFilePath(clean)) {
      const type = clean.endsWith("/") || clean.endsWith("\\") ? "folder" : "file";
      links.push({ type, value: clean, start, end: start + clean.length });
    }
  }

  return links.sort((a, b) => a.start - b.start);
}
