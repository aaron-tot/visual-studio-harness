/**
 * Builtin `searchOnline` tool — self-contained ctx entry.
 *
 * Consolidated entry for the former `websearch` (action=search: query providers
 * from the search-provider registry with fallback chain) and `webfetch`
 * (action=fetch: fetch one known URL, markdown/text/html). Dispatches on the
 * required `action` enum. Only node:path-free code + global `fetch` are used;
 * the registry comes from `ctx.getSearchProviderRegistry()`, webFetch settings
 * from `ctx.toolSettings?.webFetch`.
 */

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

interface SearchCallOptions {
  query: string;
  type?: string;
  numResults?: number;
  livecrawl?: string;
  contextMaxCharacters?: number;
  providerId?: string;
  batchRotation?: boolean;
}

interface SearchAttemptResult {
  providerId: string;
  providerName: string;
  success: boolean;
  text?: string;
  error?: string;
  rateLimited: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

// ─────────────────────────── websearch (search) ───────────────────────────

function buildProviderSequence(registry: any, options: SearchCallOptions): any[] {
  if (options.providerId) {
    const p = registry.getById(options.providerId);
    return p ? [p] : [];
  }
  if (options.batchRotation) {
    const rotation = registry.getBatchRotation();
    if (rotation.length > 0) {
      const startIdx = (registry.batchRotationIndex ?? 0) % rotation.length;
      return [...rotation.slice(startIdx), ...rotation.slice(0, startIdx)];
    }
  }
  const primary = registry.getPrimary();
  const fallbacks = registry.getFallbacks();
  return primary ? [primary, ...fallbacks] : fallbacks;
}

function buildHeaders(provider: any): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "VisualStudioHarness/websearch",
  };
  if (provider.type === "parallel" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  } else if (provider.type === "brave" && provider.apiKey) {
    headers["X-Subscription-Token"] = provider.apiKey;
  } else if (provider.type === "serper" && provider.apiKey) {
    headers["X-API-KEY"] = provider.apiKey;
  } else if (provider.type === "custom" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate limited") ||
    lower.includes("too many requests") ||
    lower.includes("quota exceeded")
  );
}

/** JSON-RPC tools/call against an MCP HTTP endpoint (SSE or JSON body). */
async function mcpToolsCall(
  url: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<string | undefined> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ac.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: toolArgs },
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} from ${url}` + (errBody ? `: ${errBody.slice(0, 300)}` : "")
      );
    }

    const body = await res.text();
    return parseMcpToolText(body);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Parse MCP tools/call result from JSON or SSE data lines. */
function parseMcpToolText(body: string): string | undefined {
  const tryParse = (payload: string): string | undefined => {
    const trimmed = payload.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      const data = JSON.parse(trimmed) as {
        result?: { content?: Array<{ type?: string; text?: string }> };
        error?: { message?: string };
      };
      if (data.error?.message) {
        throw new Error(data.error.message);
      }
      const content = data.result?.content;
      if (!Array.isArray(content)) return undefined;
      return content.find((c) => typeof c.text === "string")?.text;
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.includes("JSON")) {
        throw e;
      }
      return undefined;
    }
  };

  const direct = tryParse(body);
  if (direct) return direct;

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const hit = tryParse(line.slice(6));
    if (hit) return hit;
  }
  return undefined;
}

async function runSearch(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata?: Record<string, unknown>; isError?: boolean }> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return {
      title: "websearch",
      output: "ERROR websearch: query is required",
      isError: true,
    };
  }

  // Prefer the tool's own searchProviders (from searchOnline.json, injected on
  // the ctx by folderToToolDef) — but only when at least one is actually
  // enabled. The seeded folders ship disabled example providers, so when all of
  // the folder's providers are off (or there are none) fall back to the global
  // registry singleton, which holds any providers enabled via config.json.
  const providers = ctx.searchProviders;
  const enabled = Array.isArray(providers)
    ? providers.filter((p) => p && p.enabled)
    : [];
  const registry =
    enabled.length > 0
      ? ctx.newSearchProviderRegistry(providers)
      : ctx.getSearchProviderRegistry();
  const options: SearchCallOptions = {
    query,
    type: typeof args.type === "string" ? args.type : "auto",
    numResults: typeof args.numResults === "number" ? args.numResults : 8,
    livecrawl: typeof args.livecrawl === "string" ? args.livecrawl : "fallback",
    contextMaxCharacters:
      typeof args.contextMaxCharacters === "number" ? args.contextMaxCharacters : undefined,
    providerId: typeof args.provider === "string" ? args.provider : undefined,
    batchRotation: typeof args.provider !== "string", // batch rotation if no explicit provider
  };

  const attempts: SearchAttemptResult[] = [];
  let finalResult: { text: string; providerId: string; providerName: string } | null = null;

  const providerSequence = buildProviderSequence(registry, options);

  for (const provider of providerSequence) {
    if (registry.isRateLimited(provider.id)) {
      attempts.push({
        providerId: provider.id,
        providerName: provider.name,
        success: false,
        error: "Rate limited (local)",
        rateLimited: true,
      });
      continue;
    }

    const attempt = await attemptSearch(provider, options, ctx, registry);
    attempts.push(attempt);

    if (attempt.success && attempt.text) {
      finalResult = {
        text: attempt.text,
        providerId: provider.id,
        providerName: provider.name,
      };
      break;
    }

    if (attempt.rateLimited) {
      registry.markRateLimited(provider.id);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    // For other errors, don't fallback (could be query error, network, etc.)
    break;
  }

  const year = new Date().getFullYear();
  const usedFallback = attempts.length > 1 && finalResult !== null;
  const attemptedIds = attempts.map((a) => a.providerId);

  if (!finalResult) {
    const lastError = attempts[attempts.length - 1]?.error ?? "Unknown error";
    const lastProvider = attempts[attempts.length - 1]?.providerName ?? "unknown";
    return {
      title: `websearch: ${query}`,
      output: `ERROR websearch (${lastProvider}): ${lastError}`,
      isError: true,
      metadata: {
        provider: attempts[0]?.providerId,
        query,
        attempted: attemptedIds,
        fallback: usedFallback,
      },
    };
  }

  const body =
    finalResult.text.trim() || "No search results found. Try a different query or provider.";

  return {
    title: `${finalResult.providerName}: ${query}`,
    output:
      body +
      `\n\n(provider=${finalResult.providerId}${usedFallback ? "; fallback used" : ""}; tip: use webfetch on promising URLs; current year ${year})`,
    metadata: {
      provider: finalResult.providerId,
      providerName: finalResult.providerName,
      query,
      type: typeof args.type === "string" ? args.type : "auto",
      livecrawl: typeof args.livecrawl === "string" ? args.livecrawl : "fallback",
      numResults: typeof args.numResults === "number" ? args.numResults : 8,
      attempted: attemptedIds,
      fallback: usedFallback,
    },
  };
}

async function attemptSearch(
  provider: any,
  options: SearchCallOptions,
  ctx: any,
  registry: any
): Promise<SearchAttemptResult> {
  try {
    const url = registry.buildMcpUrl(provider);
    const toolName = registry.getMcpToolName(provider.type);
    const toolArgs = registry.buildMcpArgs(provider.type, options.query, {
      type: options.type,
      numResults: options.numResults,
      livecrawl: options.livecrawl,
      contextMaxCharacters: options.contextMaxCharacters,
    });

    const headers = buildHeaders(provider);
    const text = await mcpToolsCall(url, toolName, toolArgs, headers, ctx.abortSignal);

    return {
      providerId: provider.id,
      providerName: provider.name,
      success: true,
      text,
      rateLimited: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const rateLimited = isRateLimitError(msg);
    return {
      providerId: provider.id,
      providerName: provider.name,
      success: false,
      error: msg,
      rateLimited,
    };
  }
}

// ─────────────────────────── webfetch (fetch) ───────────────────────────

function looksLikeHtml(s: string): boolean {
  const head = s.slice(0, 512).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    /<(div|body|p|head|meta|script)\b/.test(head)
  );
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
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Strip scripts/styles and extract readable text. */
function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Lightweight HTML → markdown (no external deps). */
function htmlToMarkdown(html: string): string {
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

async function runFetch(
  args: Record<string, unknown>,
  ctx: any
): Promise<{ title: string; output: string; metadata?: Record<string, unknown>; isError?: boolean }> {
  let url = String(args.url ?? "").trim();
  if (!url) {
    return {
      title: "webfetch",
      output: "ERROR webfetch: url is required",
      isError: true,
    };
  }
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    return {
      title: "webfetch",
      output: "ERROR webfetch: URL must start with http:// or https://",
      isError: true,
    };
  }

  const format = typeof args.format === "string" ? args.format : "markdown";
  const wfCfg = ctx.toolSettings?.webFetch ?? {};
  const min = wfCfg.timeoutMinSec ?? 1;
  const max = wfCfg.timeoutMaxSec ?? 120;
  const def = wfCfg.timeoutDefaultSec ?? 30;
  const timeoutSec = Math.max(min, Math.min(max, typeof args.timeout === "number" ? args.timeout : def));
  const timeoutMs = timeoutSec * 1000;

  let accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  if (format === "markdown") {
    accept = "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
  } else if (format === "text") {
    accept = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
  } else if (format === "html") {
    accept = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
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
    if (res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
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
      output = output.slice(0, maxOut) + `\n\n…[truncated ${output.length - maxOut} chars]`;
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
}

// ─────────────────────────── dispatch ───────────────────────────

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const action = args.action;
  if (action === "search") {
    return runSearch(args, ctx);
  }
  if (action === "fetch") {
    return runFetch(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown searchOnline action: "${String(action)}".`,
    isError: true,
  };
}
