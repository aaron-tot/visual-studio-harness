/**
 * Link detector utility.
 * 
 * Detects URLs, file paths, and folder paths in plain text.
 * Returns an array of link segments that can be rendered as clickable elements.
 * 
 * Order of priority (checked in order):
 * 1. URLs (http://, https://, ftp://, etc.)
 * 2. File paths (/absolute/path, C:\Windows\path, ./relative/path)
 * 3. Folders (/absolute/path, C:\Windows\path\)
 * 
 * Falls back to plain text when no links are found.
 */

const URL_RE =
  /https?:\/\/[^\s<>"{}|\\^`[\]]+|ftp:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+/i;

const PATH_SEGMENT_RE = /(?:[a-zA-Z]:[/\\]|\/)[\w.\-\/\\]+/;

export interface LinkSegment {
  type: "url" | "file" | "folder";
  text: string;
  startIndex: number;
  endIndex: number;
}

export type TextSegment =
  | { type: "text"; content: string }
  | { type: "link"; link: LinkSegment };

/**
 * Detect links in a string and return an array of text/link segments.
 */
export function detectLinks(text: string): TextSegment[] {
  if (!text) return [{ type: "text", content: "" }];

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let remaining = text;

  while (remaining.length > 0) {
    const urlMatch = remaining.match(URL_RE);
    const pathMatch = remaining.match(PATH_SEGMENT_RE);

    if (urlMatch && pathMatch) {
      const urlStart = urlMatch.index!;
      const pathStart = pathMatch.index!;

      if (urlStart <= pathStart) {
        if (urlStart > lastIndex) {
          segments.push({ type: "text", content: remaining.slice(0, urlStart) });
        }
        segments.push({
          type: "link",
          link: {
            type: "url",
            text: urlMatch[0],
            startIndex: lastIndex + urlStart,
            endIndex: lastIndex + urlStart + urlMatch[0].length,
          },
        });
        lastIndex = urlStart + urlMatch[0].length;
        remaining = remaining.slice(lastIndex);
      } else {
        if (pathStart > lastIndex) {
          segments.push({ type: "text", content: remaining.slice(0, pathStart) });
        }
        const pathText = pathMatch[0];
        const isFolder = pathText.endsWith("/") || pathText.endsWith("\\");
        segments.push({
          type: "link",
          link: {
            type: isFolder ? "folder" : "file",
            text: pathText,
            startIndex: lastIndex + pathStart,
            endIndex: lastIndex + pathStart + pathText.length,
          },
        });
        lastIndex = pathStart + pathText.length;
        remaining = remaining.slice(lastIndex);
      }
    } else if (urlMatch) {
      const urlStart = urlMatch.index!;
      if (urlStart > lastIndex) {
        segments.push({ type: "text", content: remaining.slice(0, urlStart) });
      }
      segments.push({
        type: "link",
        link: {
          type: "url",
          text: urlMatch[0],
          startIndex: lastIndex + urlStart,
          endIndex: lastIndex + urlStart + urlMatch[0].length,
        },
      });
      lastIndex = urlStart + urlMatch[0].length;
      remaining = remaining.slice(lastIndex);
    } else if (pathMatch) {
      const pathStart = pathMatch.index!;
      if (pathStart > lastIndex) {
        segments.push({ type: "text", content: remaining.slice(0, pathStart) });
      }
      const pathText = pathMatch[0];
      const isFolder = pathText.endsWith("/") || pathText.endsWith("\\");
      segments.push({
        type: "link",
        link: {
          type: isFolder ? "folder" : "file",
          text: pathText,
          startIndex: lastIndex + pathStart,
          endIndex: lastIndex + pathStart + pathText.length,
        },
      });
      lastIndex = pathStart + pathText.length;
      remaining = remaining.slice(lastIndex);
    } else {
      if (remaining.length > lastIndex - (lastIndex > 0 ? lastIndex : 0)) {
        segments.push({ type: "text", content: remaining });
      }
      break;
    }
  }

  return segments;
}
