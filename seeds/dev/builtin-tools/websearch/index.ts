/**
 * Builtin `websearch` tool — CONTENT-ONLY ctx entry.
 *
 * This folder is NOT seeded or registered: websearch was consolidated into the
 * `searchOnline` ToolDef (search action), which is the single callable online
 * tool in the compiled registry. This file documents the builtin module logic
 * for reference only.
 *
 * Self-contained ctx entry.
 *
 * Searches the web by query via the search-provider registry with fallback
 * chain + batch rotation, identical to the `search` path of the consolidated
 * `searchOnline` entry. The registry comes from `ctx.getSearchProviderRegistry()`.
 * Only `ctx` + global `fetch` are used — no harness internals.
 */

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

/** Build the sequence of providers to try for this call. */
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

/** Attempt search with a specific provider. */
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

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return {
      title: "websearch",
      output: "ERROR websearch: query is required",
      isError: true,
    };
  }

  const registry = ctx.getSearchProviderRegistry();
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
    // Check rate limit before attempting
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

    // If rate limited, mark and continue to next fallback
    if (attempt.rateLimited) {
      registry.markRateLimited(provider.id);
      // Small delay before trying next provider
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
