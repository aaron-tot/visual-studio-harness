import type { SearchProviderConfig, SearchProviderType } from "../../../../../_shared/types/config";

/**
 * In-memory token bucket for rate limiting per provider.
 * Resets on restart — simple and sufficient for session-scoped limiting.
 */
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per ms
}

/**
 * Registry for search providers with fallback chain and batch rotation support.
 * Built from config at startup, updated live via config watch.
 */
export class SearchProviderRegistry {
  private providers: SearchProviderConfig[] = [];
  private rateLimitBuckets = new Map<string, RateLimitBucket>();
  private batchRotationIndex = 0;

  /** Register or update a provider. */
  register(config: SearchProviderConfig): void {
    const idx = this.providers.findIndex((p) => p.id === config.id);
    if (idx >= 0) {
      this.providers[idx] = config;
    } else {
      this.providers.push(config);
    }
    // Keep sorted by priority (lower first)
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a provider by id. */
  unregister(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id);
    this.rateLimitBuckets.delete(id);
  }

  /** Replace all providers (used on config load). */
  setAll(configs: SearchProviderConfig[]): void {
    this.providers = [...configs].sort((a, b) => a.priority - b.priority);
    // Preserve rate limit state for existing providers
    const newBuckets = new Map<string, RateLimitBucket>();
    for (const p of this.providers) {
      const existing = this.rateLimitBuckets.get(p.id);
      if (existing) newBuckets.set(p.id, existing);
    }
    this.rateLimitBuckets = newBuckets;
  }

  /** Get all registered providers (sorted by priority). */
  getAll(): SearchProviderConfig[] {
    return [...this.providers];
  }

  /** Get the primary provider (lowest priority, enabled). */
  getPrimary(): SearchProviderConfig | null {
    return this.providers.find((p) => p.enabled) ?? null;
  }

  /** Get fallback providers (priority > 0, enabled), sorted by priority. */
  getFallbacks(): SearchProviderConfig[] {
    return this.providers.filter((p) => p.enabled && p.priority > 0);
  }

  /** Get providers tagged for batch rotation, sorted by priority. */
  getBatchRotation(): SearchProviderConfig[] {
    return this.providers.filter(
      (p) => p.enabled && p.tags?.includes("batch-rotate")
    );
  }

  /** Get a provider by exact id. */
  getById(id: string): SearchProviderConfig | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Get provider for a specific call.
   * - If explicit provider id given, return that provider (must be enabled).
   * - Else if batch rotation requested, return next in rotation.
   * - Else return primary.
   */
  getProviderForCall(opts: {
    explicitId?: string;
    batchRotation?: boolean;
  }): SearchProviderConfig | null {
    if (opts.explicitId) {
      const p = this.getById(opts.explicitId);
      return p?.enabled ? p : null;
    }
    if (opts.batchRotation) {
      const rotation = this.getBatchRotation();
      if (rotation.length === 0) return this.getPrimary();
      const provider = rotation[this.batchRotationIndex % rotation.length];
      this.batchRotationIndex++;
      return provider;
    }
    return this.getPrimary();
  }

  /** Record a rate limit hit for a provider. */
  markRateLimited(id: string): void {
    const bucket = this.getOrCreateBucket(id);
    bucket.tokens = 0; // drain on rate limit
  }

  /** Check if provider is currently rate limited. */
  isRateLimited(id: string): boolean {
    const bucket = this.rateLimitBuckets.get(id);
    if (!bucket) return false;
    this.refillBucket(bucket);
    return bucket.tokens < 1;
  }

  /** Consume a token for a request. Returns true if allowed. */
  consumeToken(id: string): boolean {
    const bucket = this.getOrCreateBucket(id);
    this.refillBucket(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  private getOrCreateBucket(id: string): RateLimitBucket {
    let bucket = this.rateLimitBuckets.get(id);
    if (!bucket) {
      const provider = this.getById(id);
      const rpm = provider?.rateLimit?.rpm ?? 60;
      const capacity = Math.max(1, rpm);
      bucket = {
        tokens: capacity,
        lastRefill: Date.now(),
        capacity,
        refillRate: rpm / 60_000, // tokens per ms
      };
      this.rateLimitBuckets.set(id, bucket);
    }
    return bucket;
  }

  private refillBucket(bucket: RateLimitBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + elapsed * bucket.refillRate
      );
      bucket.lastRefill = now;
    }
  }

  /** Build MCP endpoint URL for a provider. */
  buildMcpUrl(provider: SearchProviderConfig): string {
    switch (provider.type) {
      case "exa": {
        const key = provider.apiKey ?? process.env.EXA_API_KEY ?? "";
        return key
          ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(key)}`
          : "https://mcp.exa.ai/mcp";
      }
      case "parallel": {
        const key = provider.apiKey ?? process.env.PARALLEL_API_KEY ?? "";
        const base = "https://search.parallel.ai/mcp";
        return key ? `${base}?apiKey=${encodeURIComponent(key)}` : base;
      }
      case "brave": {
        const key = provider.apiKey ?? process.env.BRAVE_API_KEY ?? "";
        return `https://api.search.brave.com/mcp?apiKey=${encodeURIComponent(key)}`;
      }
      case "serper": {
        const key = provider.apiKey ?? process.env.SERPER_API_KEY ?? "";
        return `https://mcp.serper.dev/mcp?apiKey=${encodeURIComponent(key)}`;
      }
      case "custom": {
        if (!provider.customMcpUrl) {
          throw new Error(`Custom provider ${provider.id} missing customMcpUrl`);
        }
        const url = new URL(provider.customMcpUrl);
        if (provider.apiKey) {
          url.searchParams.set("apiKey", provider.apiKey);
        }
        return url.toString();
      }
      default:
        throw new Error(`Unknown provider type: ${(provider as SearchProviderConfig).type}`);
    }
  }

  /** Get MCP tool name for a provider type. */
  getMcpToolName(type: SearchProviderType): string {
    switch (type) {
      case "exa":
        return "web_search_exa";
      case "parallel":
        return "web_search";
      case "brave":
        return "web_search";
      case "serper":
        return "web_search";
      case "custom":
        return "web_search";
      default:
        return "web_search";
    }
  }

  /** Build MCP call arguments for a provider type. */
  buildMcpArgs(
    type: SearchProviderType,
    query: string,
    options?: {
      type?: string;
      numResults?: number;
      livecrawl?: string;
      contextMaxCharacters?: number;
    }
  ): Record<string, unknown> {
    switch (type) {
      case "exa":
        return {
          query,
          type: options?.type ?? "auto",
          numResults: options?.numResults ?? 8,
          livecrawl: options?.livecrawl ?? "fallback",
          ...(options?.contextMaxCharacters != null
            ? { contextMaxCharacters: options.contextMaxCharacters }
            : {}),
        };
      case "parallel":
      case "brave":
      case "serper":
      case "custom":
      default:
        return {
          objective: query,
          search_queries: [query],
        };
    }
  }
}

/** Singleton instance for the process. */
let registryInstance: SearchProviderRegistry | null = null;

export function getSearchProviderRegistry(): SearchProviderRegistry {
  if (!registryInstance) {
    registryInstance = new SearchProviderRegistry();
  }
  return registryInstance;
}

export function setSearchProviderRegistry(reg: SearchProviderRegistry): void {
  registryInstance = reg;
}
