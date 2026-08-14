import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getMode, resolveDataDir } from "../../paths";
import type { PricingSnapshot, PricingConfig, ProviderConfig, PricingTokenInput } from "../../../../_shared/types/config";

const DEFAULT_SOURCE_URL = "https://models.dev/api.json";
const DEFAULT_TTL_MINUTES = 60;
/** Short TTL for `found:false` snapshots so transient outages do not pin "not found" for the full TTL. */
const NEGATIVE_TTL_MINUTES = 5;

/** In-memory cache: key = `${sourceUrl}|${providerId}:${modelId}` */
const memoryCache = new Map<string, PricingSnapshot>();

/**
 * Catalog cache: key = sourceUrl. The full api.json download is THE stored
 * source of truth — cached in memory + persisted to disk (`pricing-catalog.json`)
 * so a restart does not re-fetch it. All provider:model lookups clone from this
 * single catalog; N models in a window cost exactly 1 network fetch (not N).
 */
const catalogCache = new Map<string, { fetchedAt: string; data: Record<string, unknown> }>();

/** Catalog disk file (the full fetched api.json per sourceUrl). */
function getCatalogCacheFilePath(): string {
  const dataDir = resolveDataDir();
  return `${dataDir}/pricing-catalog.json`;
}

/** Load the persisted full catalog into memory. */
async function loadCatalogFromDisk(): Promise<void> {
  try {
    const path = getCatalogCacheFilePath();
    if (existsSync(path)) {
      const raw = JSON.parse(await readFile(path, "utf-8")) as Record<
        string,
        { fetchedAt: string; data: Record<string, unknown> }
      >;
      for (const [key, value] of Object.entries(raw)) {
        if (value && typeof value === "object" && typeof value.fetchedAt === "string" && value.data) {
          catalogCache.set(key, value);
        }
      }
    }
  } catch {
    // Ignore corrupt catalog cache
  }
}

/** Persist the full catalog to disk (atomic rename). */
async function persistCatalogCache(): Promise<void> {
  try {
    const path = getCatalogCacheFilePath();
    const tempPath = `${path}.tmp`;
    const obj: Record<string, unknown> = {};
    for (const [key, value] of catalogCache) {
      obj[key] = value;
    }
    await writeFile(tempPath, JSON.stringify(obj), "utf-8");
    const { rename } = await import("node:fs/promises");
    await rename(tempPath, path);
  } catch {
    // Best effort
  }
}

/** Normalize a base URL for provider matching: trim, strip trailing slashes, lowercase. */
function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Find the catalog slug whose `api` (base URL) matches the given base URL. */
function resolveByUrl(catalog: Record<string, unknown>, baseUrl: string): string | null {
  const target = normalizeApiUrl(baseUrl);
  if (!target) return null;
  for (const [slug, entry] of Object.entries(catalog)) {
    const api = (entry as Record<string, unknown>)?.api;
    if (typeof api === "string" && normalizeApiUrl(api) === target) {
      return slug;
    }
  }
  return null;
}

/**
 * Resolve the models.dev catalog provider id for a provider config.
 * Priority: explicit `pricingProviderId` → URL match against the catalog's
 * provider `api` (trailing-/ stripped, case-insensitive) → null.
 * The display name is deliberately NOT used (users may name providers anything).
 */
export function resolveModelsDevProviderId(
  provider: ProviderConfig,
  catalog?: Record<string, unknown>
): string | null {
  // Explicit override always wins
  if (provider.pricingProviderId) return provider.pricingProviderId;

  // Local/self-hosted providers (localhost or test) have no catalog entry
  if (provider.baseUrl.includes("localhost") || provider.test) return null;

  // URL match requires the catalog; without it we cannot resolve.
  return catalog ? resolveByUrl(catalog, provider.baseUrl) : null;
}

/** Cache file path for the current mode */
function getCacheFilePath(): string {
  const dataDir = resolveDataDir();
  return `${dataDir}/pricing-cache.json`;
}

/** Load disk cache into memory */
export async function loadPricingCache(): Promise<void> {
  try {
    const cachePath = getCacheFilePath();
    if (existsSync(cachePath)) {
      const content = await readFile(cachePath, "utf-8");
      const cached = JSON.parse(content);
      if (cached && typeof cached === "object") {
        for (const [key, value] of Object.entries(cached)) {
          memoryCache.set(key, value as PricingSnapshot);
        }
      }
    }
  } catch {
    // Ignore corrupt cache
  }
}

/** Write memory cache to disk (atomic rename) */
async function persistPricingCache(): Promise<void> {
  try {
    const cachePath = getCacheFilePath();
    const tempPath = `${cachePath}.tmp`;
    const obj: Record<string, PricingSnapshot> = {};
    for (const [key, value] of memoryCache) {
      obj[key] = value;
    }
    await writeFile(tempPath, JSON.stringify(obj), "utf-8");
    // Atomic rename on same filesystem
    const { rename } = await import("node:fs/promises");
    await rename(tempPath, cachePath);
  } catch {
    // Best effort
  }
}

/** Generate cache key */
function cacheKey(sourceUrl: string, providerId: string, modelId: string): string {
  return `${sourceUrl}|${providerId}:${modelId}`;
}

/** Check if a timestamp is within the TTL window. */
function isFreshAt(fetchedAt: string, ttlMinutes: number): boolean {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs < ttlMinutes * 60 * 1000;
}

/** Check if a snapshot is fresh; failures use the shorter negative TTL. */
function isFresh(snapshot: PricingSnapshot, ttlMinutes: number): boolean {
  return isFreshAt(snapshot.fetchedAt, snapshot.found ? ttlMinutes : NEGATIVE_TTL_MINUTES);
}

/** Get the catalog: memory → persisted disk → network, once per TTL window. */
async function getCatalog(sourceUrl: string, ttlMinutes: number): Promise<Record<string, unknown>> {
  const cached = catalogCache.get(sourceUrl);
  if (cached && isFreshAt(cached.fetchedAt, ttlMinutes)) {
    return cached.data;
  }
  // Fall back to the persisted catalog before hitting the network.
  if (!cached) await loadCatalogFromDisk();
  const fromDisk = catalogCache.get(sourceUrl);
  if (fromDisk && isFreshAt(fromDisk.fetchedAt, ttlMinutes)) {
    return fromDisk.data;
  }
  // Full download is the only fetch path (no per-provider endpoint exists).
  const data = await fetchModelsDevCatalog(sourceUrl);
  catalogCache.set(sourceUrl, { fetchedAt: new Date().toISOString(), data });
  await persistCatalogCache();
  return data;
}

/** Fetch the models.dev catalog */
async function fetchModelsDevCatalog(sourceUrl: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "visual-studio-harness/pricing" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** Normalize a models.dev model entry into a PricingSnapshot */
function normalizeSnapshot(
  providerId: string,
  providerDisplayName: string,
  modelId: string,
  modelEntry: Record<string, unknown>,
  sourceUrl: string
): PricingSnapshot {
  const cost = modelEntry.cost as Record<string, unknown> | undefined;
  const limit = modelEntry.limit as Record<string, unknown> | undefined;

  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
    return {
      providerId,
      providerDisplayName,
      modelId,
      found: false,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
      error: "Missing or invalid cost entry in catalog",
    };
  }

  const snapshot: PricingSnapshot = {
    providerId,
    providerDisplayName,
    modelId,
    found: true,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    rates: {
      inputPerM: cost.input,
      outputPerM: cost.output,
      cacheReadPerM: typeof cost.cache_read === "number" ? cost.cache_read : 0,
      cacheWritePerM: typeof cost.cache_write === "number" ? cost.cache_write : 0,
    },
  };

  // Tiers
  if (Array.isArray(cost.tiers)) {
    snapshot.tiers = cost.tiers
      .filter((t): t is Record<string, unknown> => t && typeof t === "object")
      .map((t) => ({
        size: Number((t.tier as { size?: unknown } | undefined)?.size ?? t.size ?? 0),
        input: typeof t.input === "number" ? t.input : 0,
        output: typeof t.output === "number" ? t.output : 0,
        cacheRead: typeof t.cache_read === "number" ? t.cache_read : undefined,
        cacheWrite: typeof t.cache_write === "number" ? t.cache_write : undefined,
      }))
      .filter((t) => t.size > 0);
  }

  // Context over 200k
  if (cost.context_over_200k && typeof cost.context_over_200k === "object") {
    const c = cost.context_over_200k as Record<string, unknown>;
    snapshot.contextOver200K = {
      input: typeof c.input === "number" ? c.input : 0,
      output: typeof c.output === "number" ? c.output : 0,
      cacheRead: typeof c.cache_read === "number" ? c.cache_read : undefined,
      cacheWrite: typeof c.cache_write === "number" ? c.cache_write : undefined,
    };
  }

  // Limits
  if (limit && typeof limit.context === "number") {
    snapshot.limitContext = limit.context;
  }

  return snapshot;
}

/** Main entry: get pricing for a provider:model */
export async function getModelPricing(
  provider: ProviderConfig,
  modelName: string,
  config: { pricing?: PricingConfig } = {},
  dataDir?: string
): Promise<PricingSnapshot> {
  const pricingConfig = config.pricing ?? {};
  const sourceUrl = pricingConfig.sourceUrl ?? DEFAULT_SOURCE_URL;
  const ttlMinutes = pricingConfig.cacheTtlMinutes ?? DEFAULT_TTL_MINUTES;

  const notFound = (error: string, providerId = ""): PricingSnapshot => ({
    providerId,
    providerDisplayName: provider.displayName,
    modelId: modelName,
    found: false,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
    error,
  });

  // Local/self-hosted (no override) — never in the catalog; skip the fetch.
  if (!provider.pricingProviderId && (provider.baseUrl.includes("localhost") || provider.test)) {
    return notFound("Provider not in models.dev catalog (local/self-hosted or unknown)");
  }

  // Fetch catalog (shared download — TTL throttles the network), then resolve the
  // provider id by URL (or explicit override). URL resolution requires the catalog.
  let providerId: string | null | undefined;
  let key: string | undefined;
  try {
    const catalog = await getCatalog(sourceUrl, ttlMinutes);
    providerId = provider.pricingProviderId ?? resolveByUrl(catalog, provider.baseUrl);
    if (!providerId) {
      return notFound("Provider not in models.dev catalog (local/self-hosted or unknown)");
    }

    key = cacheKey(sourceUrl, providerId, modelName);

    // Check memory cache
    const cached = memoryCache.get(key);
    if (cached && isFresh(cached, ttlMinutes)) {
      return cached;
    }

    const providerEntry = catalog[providerId] as Record<string, unknown> | undefined;

    if (!providerEntry) {
      const snap: PricingSnapshot = {
        providerId,
        providerDisplayName: provider.displayName,
        modelId: modelName,
        found: false,
        sourceUrl,
        fetchedAt: new Date().toISOString(),
        rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
        error: `Provider "${providerId}" not found in models.dev catalog`,
      };
      memoryCache.set(key, snap);
      await persistPricingCache();
      return snap;
    }

    const models = providerEntry.models as Record<string, unknown> | undefined;
    if (!models || !models[modelName]) {
      const snap: PricingSnapshot = {
        providerId,
        providerDisplayName: provider.displayName,
        modelId: modelName,
        found: false,
        sourceUrl,
        fetchedAt: new Date().toISOString(),
        rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
        error: `Model "${modelName}" not found in provider "${providerId}" catalog`,
      };
      memoryCache.set(key, snap);
      await persistPricingCache();
      return snap;
    }

    const snapshot = normalizeSnapshot(providerId, provider.displayName, modelName, models[modelName] as Record<string, unknown>, sourceUrl);
    memoryCache.set(key, snapshot);
    await persistPricingCache();
    return snapshot;
  } catch (err) {
    const snap: PricingSnapshot = {
      providerId: providerId ?? "",
      providerDisplayName: provider.displayName,
      modelId: modelName,
      found: false,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
    if (key) memoryCache.set(key, snap);
    await persistPricingCache();
    return snap;
  }
}

/**
 * Force a full catalog re-download (bypass TTL). Since the fetch is always the
 * entire api.json, "refresh" means invalidating the shared catalog cache for the
 * sourceUrl so the next lookup hits the network. Provider:model resolution is
 * NOT involved in triggering a refresh.
 */
export async function refreshPricingCatalog(sourceUrl?: string): Promise<string> {
  const url = sourceUrl ?? DEFAULT_SOURCE_URL;
  // Force a full re-download + re-store (bypass TTL), replacing any persisted catalog.
  const data = await fetchModelsDevCatalog(url);
  const fetchedAt = new Date().toISOString();
  catalogCache.set(url, { fetchedAt, data });
  await persistCatalogCache();
  return fetchedAt;
}

/**
 * Force refresh for a specific provider:model snapshot. Since the fetch is always
 * the full catalog, this delegates to `refreshPricingCatalog` (a real network
 * re-download + re-store) then re-reads the model from the fresh catalog.
 */
export async function refreshModelPricing(
  provider: ProviderConfig,
  modelName: string,
  config: { pricing?: PricingConfig } = {},
  dataDir?: string
): Promise<PricingSnapshot> {
  const pricingConfig = config.pricing ?? {};
  const sourceUrl = pricingConfig.sourceUrl ?? DEFAULT_SOURCE_URL;
  await refreshPricingCatalog(sourceUrl);
  const catalog = catalogCache.get(sourceUrl)?.data;
  const providerId = resolveModelsDevProviderId(provider, catalog);
  if (providerId) memoryCache.delete(cacheKey(sourceUrl, providerId, modelName));
  return getModelPricing(provider, modelName, config, dataDir);
}

/** Clear in-memory caches (tests / config reload). */
export function resetPricingCache(): void {
  memoryCache.clear();
  catalogCache.clear();
}

/** Last time the catalog for sourceUrl was fetched (memory-cached), or null. */
export function getCatalogUpdatedAt(sourceUrl?: string): string | null {
  const url = sourceUrl ?? DEFAULT_SOURCE_URL;
  return catalogCache.get(url)?.fetchedAt ?? null;
}

/** Get cached snapshot without fetching */
export function getCachedPricing(
  provider: ProviderConfig,
  modelName: string,
  config: { pricing?: PricingConfig } = {}
): PricingSnapshot | null {
  const pricingConfig = config.pricing ?? {};
  const sourceUrl = pricingConfig.sourceUrl ?? DEFAULT_SOURCE_URL;
  const catalog = catalogCache.get(sourceUrl)?.data;
  const providerId = resolveModelsDevProviderId(provider, catalog);
  if (!providerId) return null;
  const key = cacheKey(sourceUrl, providerId, modelName);
  return memoryCache.get(key) ?? null;
}

/** Initialize caches on startup (load from disk) */
export async function initPricingCache(): Promise<void> {
  await loadPricingCache();
  await loadCatalogFromDisk();
}
