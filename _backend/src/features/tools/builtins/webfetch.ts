import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const FormatSchema = z.enum(["markdown", "text", "html"]);

/**
 * Fetch a known URL.
 * Use websearch when you do not already have a URL.
 */
export const webfetchTool: ToolDef = {
  name: "webfetch",
  description:
    "Fetch one known URL (markdown/text/html). Use when you already have a link. For discovery without a URL, use websearch first.",
  permissionDefault: "allow",
  outputFields: [
    { name: "url", type: "string", description: "The URL that was fetched", required: true },
    { name: "format", type: "enum(markdown | text | html)", description: "Return format", required: true },
    { name: "truncated", type: "boolean", description: "Whether the response was truncated (max 5MB)", required: false },
  ],
  inputSchema: z.object({
    url: z
      .string()
      .describe("Fully-formed http(s) URL to fetch"),
    format: FormatSchema.optional().describe(
      "Return format: markdown (default), text, or html"
    ),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .describe("Timeout in seconds (default 30, max 120)"),
  }),
  execute: async (args, ctx) => {
    let url = (args.url || "").trim();
    if (!url) {
      return {
        title: "webfetch",
        output: "ERROR webfetch: url is required",
        isError: true,
      };
    }
    if (url.startsWith("http://")) {
      url = "https://" + url.slice("http://".length);
    }
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return {
        title: "webfetch",
        output: "ERROR webfetch: URL must start with http:// or https://",
        isError: true,
      };
    }

    const format = args.format ?? "markdown";
    const timeoutMs = Math.min(
      (args.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
      MAX_TIMEOUT_MS
    );

    let accept =
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    if (format === "markdown") {
      accept =
        "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    } else if (format === "text") {
      accept =
        "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    } else if (format === "html") {
      accept =
        "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
    }

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
    };

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.abortSignal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      let res = await fetch(url, { headers, signal: ac.signal });
      // Retry with honest UA if Cloudflare bot challenge
      if (
        res.status === 403 &&
        res.headers.get("cf-mitigated") === "challenge"
      ) {
        res = await fetch(url, {
          headers: { ...headers, "User-Agent": "VisualStudioHarness" },
          signal: ac.signal,
        });
      }

      if (!res.ok) {
        return {
          title: url,
          output: `ERROR webfetch: HTTP ${res.status} ${res.statusText} for ${url}`,
          isError: true,
          metadata: { url, status: res.status },
        };
      }

      const lenHeader = res.headers.get("content-length");
      if (lenHeader && parseInt(lenHeader, 10) > MAX_RESPONSE_SIZE) {
        return {
          title: url,
          output: "ERROR webfetch: response exceeds 5MB limit",
          isError: true,
        };
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_RESPONSE_SIZE) {
        return {
          title: url,
          output: "ERROR webfetch: response exceeds 5MB limit",
          isError: true,
        };
      }

      const contentType = res.headers.get("content-type") || "";
      const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";
      if (mime.startsWith("image/")) {
        return {
          title: `${url} (${contentType})`,
          output: `Image fetched (${mime}, ${buf.byteLength} bytes). Binary image data is not inlined; open the URL directly if needed.`,
          metadata: { url, contentType, bytes: buf.byteLength },
        };
      }

      const content = buf.toString("utf-8");
      const isHtml = contentType.includes("text/html") || looksLikeHtml(content);
      let output = content;
      if (format === "markdown" && isHtml) {
        output = htmlToMarkdown(content);
      } else if (format === "text" && isHtml) {
        output = htmlToText(content);
      }

      // Cap huge pages in the tool result
      const maxOut = 200_000;
      if (output.length > maxOut) {
        output =
          output.slice(0, maxOut) +
          `\n\n…[truncated ${output.length - maxOut} chars]`;
      }

      return {
        title: `${url} (${contentType || "unknown"})`,
        output,
        metadata: {
          url,
          format,
          contentType,
          bytes: buf.byteLength,
        },
      };
    } catch (err: unknown) {
      if (ac.signal.aborted) {
        return {
          title: url,
          output: `ERROR webfetch: request timed out or aborted (${timeoutMs}ms)`,
          isError: true,
        };
      }
      return {
        title: url,
        output: `ERROR webfetch: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      ctx.abortSignal.removeEventListener("abort", onAbort);
    }
  },
};

function looksLikeHtml(s: string): boolean {
  const head = s.slice(0, 512).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    /<(div|body|p|head|meta|script)\b/.test(head)
  );
}

/** Strip scripts/styles and extract readable text. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Lightweight HTML → markdown (no external deps). */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const n = Math.min(6, Math.max(1, parseInt(level, 10) || 1));
    return `\n${"#".repeat(n)} ${stripTags(inner).trim()}\n\n`;
  });
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = stripTags(inner).trim() || href;
    return `[${text}](${href})`;
  });
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
    return `\n\`\`\`\n${stripTags(inner).trim()}\n\`\`\`\n\n`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
    return `- ${stripTags(inner).trim()}\n`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|tr)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}
