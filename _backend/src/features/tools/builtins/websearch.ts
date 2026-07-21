import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

/**
 * Web search via Exa or Parallel (OpenCode-style).
 *
 * Provider selection (first match wins):
 *   1. per-call `provider` arg
 *   2. env WEBSEARCH_PROVIDER / VISUAL_STUDIO_HARNESS_WEBSEARCH_PROVIDER = exa|parallel
 *   3. VISUAL_STUDIO_HARNESS_ENABLE_PARALLEL=1 or OPENCODE_ENABLE_PARALLEL=1 → parallel
 *   4. VISUAL_STUDIO_HARNESS_ENABLE_EXA=1 or OPENCODE_ENABLE_EXA=1 → exa
 *   5. stable A/B from session id
 *
 * Optional keys: EXA_API_KEY, PARALLEL_API_KEY
 */

export type WebSearchProvider = "exa" | "parallel";

const LivecrawlSchema = z.enum(["fallback", "preferred"]);
const SearchTypeSchema = z.enum(["auto", "fast", "deep"]);
const ProviderSchema = z.enum(["exa", "parallel"]);

const EXA_MCP =
  process.env.EXA_API_KEY != null && process.env.EXA_API_KEY !== ""
    ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
    : "https://mcp.exa.ai/mcp";
const PARALLEL_MCP = "https://search.parallel.ai/mcp";

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

/**
 * Pick Exa or Parallel for this session / call.
 */
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
  const hash = createHash("sha256").update(sessionId || "default").digest();
  return hash[0]! % 2 === 0 ? "exa" : "parallel";
}

export function webSearchProviderLabel(provider: WebSearchProvider): string {
  return provider === "parallel" ? "Parallel Web Search" : "Exa Web Search";
}

export const websearchTool: ToolDef = {
  name: "websearch",
  description:
    "Search the web by query (discovery). Use when you do not have a URL. After you have a link, use webfetch to read it. Backends: exa | parallel (auto, env, or provider arg).",
  permissionDefault: "allow",
  outputFields: [
    { name: "query", type: "string", description: "The search query", required: true },
    { name: "count", type: "integer", description: "Number of results returned", required: true },
    { name: "provider", type: "enum(exa | parallel)", description: "Which search backend was used", required: false },
  ],
  inputSchema: z.object({
    query: z.string().describe("Search query (include year for current events)"),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of results (default 8)"),
    type: SearchTypeSchema.optional().describe(
      "Search depth: auto (default), fast, or deep (Exa)"
    ),
    livecrawl: LivecrawlSchema.optional().describe(
      "Live crawl: fallback (default) or preferred (Exa)"
    ),
    contextMaxCharacters: z
      .number()
      .int()
      .min(500)
      .max(50_000)
      .optional()
      .describe("Max context chars for LLM (default ~10000, Exa)"),
    provider: ProviderSchema.optional().describe(
      "Force backend: exa or parallel (overrides env/A-B)"
    ),
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

    const provider = selectWebSearchProvider(ctx.sessionId, {
      override: args.provider,
    });
    const label = webSearchProviderLabel(provider);
    const year = new Date().getFullYear();

    try {
      const text =
        provider === "parallel"
          ? await callParallelSearch(query, ctx)
          : await callExaSearch(
              {
                query,
                type: args.type ?? "auto",
                numResults: args.numResults ?? 8,
                livecrawl: args.livecrawl ?? "fallback",
                contextMaxCharacters: args.contextMaxCharacters,
              },
              ctx
            );

      const body =
        text?.trim() ||
        "No search results found. Try a different query or provider.";

      return {
        title: `${label}: ${query}`,
        output:
          body +
          `\n\n(provider=${provider}; tip: use webfetch on promising URLs; current year ${year})`,
        metadata: {
          provider,
          query,
          type: args.type ?? "auto",
          livecrawl: args.livecrawl ?? "fallback",
          numResults: args.numResults ?? 8,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        title: `${label}: ${query}`,
        output: `ERROR websearch (${provider}): ${msg}`,
        isError: true,
        metadata: { provider, query },
      };
    }
  },
};

async function callExaSearch(
  params: {
    query: string;
    type: string;
    numResults: number;
    livecrawl: string;
    contextMaxCharacters?: number;
  },
  ctx: { abortSignal: AbortSignal }
): Promise<string | undefined> {
  return mcpToolsCall(
    EXA_MCP,
    "web_search_exa",
    {
      query: params.query,
      type: params.type,
      numResults: params.numResults,
      livecrawl: params.livecrawl,
      ...(params.contextMaxCharacters != null
        ? { contextMaxCharacters: params.contextMaxCharacters }
        : {}),
    },
    {},
    ctx.abortSignal
  );
}

async function callParallelSearch(
  query: string,
  ctx: { sessionId: string; abortSignal: AbortSignal }
): Promise<string | undefined> {
  const headers: Record<string, string> = {
    "User-Agent": "VisualStudioHarness/websearch",
  };
  if (process.env.PARALLEL_API_KEY) {
    headers.Authorization = `Bearer ${process.env.PARALLEL_API_KEY}`;
  }
  return mcpToolsCall(
    PARALLEL_MCP,
    "web_search",
    {
      objective: query,
      search_queries: [query],
      session_id: ctx.sessionId,
    },
    headers,
    ctx.abortSignal
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
