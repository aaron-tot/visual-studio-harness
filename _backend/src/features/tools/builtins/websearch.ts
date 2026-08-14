import { z } from "zod";
import type { ToolDef, BaseToolContext } from "../types";
import type { SearchProviderConfig } from "../../../../../_shared/types";
import { getSearchProviderRegistry, SearchProviderRegistry } from "../host/search-provider-registry";

/**
 * Web search via configurable providers with fallback chain and batch rotation.
 *
 * Provider selection:
 *   1. per-call `provider` arg (explicit provider id)
 *   2. batch rotation (if multiple calls in same turn)
 *   3. primary provider from registry
 *
 * Fallback chain: on rate limit (429) or configured retryable error,
 * iterates through fallback providers until success or exhausted.
 */

const LivecrawlSchema = z.enum(["fallback", "preferred"]);
const SearchTypeSchema = z.enum(["auto", "fast", "deep"]);

// Provider id is now dynamic from registry, but we validate it's a known id at runtime
const ProviderIdSchema = z.string().optional().describe("Force specific provider by id");

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

export const websearchTool: ToolDef = {
  name: "websearch",
  description:
    "Search the web by query when you have no URL. Supports multiple providers with automatic fallback on rate limits. See skill:websearch.",
  permissionDefault: "allow",
  outputFields: [
    { name: "query", type: "string", description: "The search query", required: true },
    { name: "count", type: "integer", description: "Number of results returned", required: true },
    { name: "provider", type: "string", description: "Search backend used", required: false },
    { name: "fallback", type: "boolean", description: "Whether fallback was used", required: false },
    { name: "attempted", type: "array", description: "List of provider ids attempted", required: false },
  ],
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of results"),
    type: SearchTypeSchema.optional().describe(
      "Search depth: auto, fast, or deep"
    ),
    livecrawl: LivecrawlSchema.optional().describe(
      "Live crawl: fallback or preferred"
    ),
    contextMaxCharacters: z
      .number()
      .int()
      .min(500)
      .max(50_000)
      .optional()
      .describe("Max context chars for LLM"),
    provider: ProviderIdSchema,
  }),
  execute: async (args, ctx) => {
    const query = (args.query || "").trim();
    if (!query) {
      return {
        title: "websearch",
        output: "ERROR websearch: query is required",
        isError: true,
      };
    }

    const registry = getSearchProviderRegistry();
    const options: SearchCallOptions = {
      query,
      type: args.type ?? "auto",
      numResults: args.numResults ?? 8,
      livecrawl: args.livecrawl ?? "fallback",
      contextMaxCharacters: args.contextMaxCharacters,
      providerId: args.provider,
      batchRotation: !args.provider, // Use batch rotation if no explicit provider
    };

    const attempts: SearchAttemptResult[] = [];
    let finalResult: { text: string; providerId: string; providerName: string } | null = null;

    // Determine provider sequence
    const providerSequence = buildProviderSequence(registry, options, ctx.sessionId);

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

    const body = finalResult.text.trim() || "No search results found. Try a different query or provider.";

    return {
      title: `${finalResult.providerName}: ${query}`,
      output:
        body +
        `\n\n(provider=${finalResult.providerId}${usedFallback ? "; fallback used" : ""}; tip: use webfetch on promising URLs; current year ${year})`,
      metadata: {
        provider: finalResult.providerId,
        providerName: finalResult.providerName,
        query,
        type: args.type ?? "auto",
        livecrawl: args.livecrawl ?? "fallback",
        numResults: args.numResults ?? 8,
        attempted: attemptedIds,
        fallback: usedFallback,
      },
    };
  },
};

/** Build the sequence of providers to try for this call. */
function buildProviderSequence(
  registry: SearchProviderRegistry,
  options: SearchCallOptions,
  sessionId: string
): SearchProviderConfig[] {
  // Explicit provider requested
  if (options.providerId) {
    const p = registry.getById(options.providerId);
    return p ? [p] : [];
  }

  // Batch rotation
  if (options.batchRotation) {
    const rotation = registry.getBatchRotation();
    if (rotation.length > 0) {
      // Return in rotation order starting from current index
      const startIdx = registry["batchRotationIndex"] % rotation.length;
      return [
        ...rotation.slice(startIdx),
        ...rotation.slice(0, startIdx),
      ];
    }
  }

  // Default: primary then fallbacks
  const primary = registry.getPrimary();
  const fallbacks = registry.getFallbacks();
  return primary ? [primary, ...fallbacks] : fallbacks;
}

/** Attempt search with a specific provider. */
async function attemptSearch(
  provider: SearchProviderConfig[][0],
  options: SearchCallOptions,
  ctx: BaseToolContext,
  registry: SearchProviderRegistry
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

function buildHeaders(provider: SearchProviderConfig[][0]): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "VisualStudioHarness/websearch",
  };

  // Add auth headers based on provider type
  if (provider.type === "parallel" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  } else if (provider.type === "exa" && provider.apiKey) {
    // Exa uses query param in URL, not header
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
        `HTTP ${res.status} from ${url}` +
          (errBody ? `: ${errBody.slice(0, 300)}` : "")
      );
    }

    const body = await res.text();
    const text = parseMcpToolText(body);
    return text;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Parse MCP tools/call result from JSON or SSE data lines. */
export function parseMcpToolText(body: string): string | undefined {
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
      const text = content.find((c) => typeof c.text === "string")?.text;
      return text;
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

// Keep exports for backward compatibility with tests
export type WebSearchProvider = "exa" | "parallel";

export function readWebSearchFlags(env: NodeJS.ProcessEnv = process.env): {
  exa: boolean;
  parallel: boolean;
} {
  const truthy = (v: string | undefined) =>
    v === "1" || v === "true" || v === "yes";
  return {
    exa:
      truthy(env.VISUAL_STUDIO_HARNESS_ENABLE_EXA) ||
      truthy(env.OPENCODE_ENABLE_EXA),
    parallel:
      truthy(env.VISUAL_STUDIO_HARNESS_ENABLE_PARALLEL) ||
      truthy(env.OPENCODE_ENABLE_PARALLEL),
  };
}

export function selectWebSearchProvider(
  sessionId: string,
  opts?: {
    override?: WebSearchProvider;
    flags?: { exa: boolean; parallel: boolean };
    env?: NodeJS.ProcessEnv;
  }
): WebSearchProvider {
  if (opts?.override === "exa" || opts?.override === "parallel") {
    return opts.override;
  }
  const env = opts?.env ?? process.env;
  const fromEnv = (
    env.WEBSEARCH_PROVIDER ||
    env.VISUAL_STUDIO_HARNESS_WEBSEARCH_PROVIDER ||
    env.OPENCODE_WEBSEARCH_PROVIDER ||
    ""
  )
    .trim()
    .toLowerCase();
  if (fromEnv === "exa" || fromEnv === "parallel") return fromEnv;

  const flags = opts?.flags ?? readWebSearchFlags(env);
  if (flags.parallel && !flags.exa) return "parallel";
  if (flags.exa && !flags.parallel) return "exa";
  if (flags.parallel) return "parallel";
  if (flags.exa) return "exa";

  // Stable A/B per session (like OpenCode checksum)
  const hash = require("node:crypto").createHash("sha256").update(sessionId || "default").digest();
  return hash[0]! % 2 === 0 ? "exa" : "parallel";
}

export function webSearchProviderLabel(provider: WebSearchProvider): string {
  return provider === "parallel" ? "Parallel Web Search" : "Exa Web Search";
}
