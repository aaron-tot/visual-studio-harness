import type { FastifyInstance } from "fastify";
import type { ConfigFile, ProviderConfig } from "../../../_shared/types";
import { getModelPricing, getCachedPricing, getCatalogUpdatedAt, refreshPricingCatalog } from "../features/pricing/models-dev";

const DEFAULT_SOURCE_URL = "https://models.dev/api.json";

/**
 * Resolve a concrete default provider:model for previews. Tolerant of a
 * placeholder `defaultModel` (e.g. "Default Model") by falling back to the
 * provider's first enabled model. The refresh/status endpoints always fetch
 * the FULL catalog; the provider:model is only for showing one snapshot.
 */
function resolvePreview(
  config: ConfigFile,
  query?: { provider?: string; model?: string },
): { provider?: ProviderConfig; modelName?: string } {
  const provider =
    (query?.provider ? config.providers.find((p) => p.displayName === query.provider) : null) ??
    (config.defaultProvider ? config.providers.find((p) => p.displayName === config.defaultProvider) : null) ??
    config.providers[0];
  if (!provider) return {};

  const defaultModel = config.defaultModel ?? "";
  const modelName =
    provider.models.find((m) => m.modelName === defaultModel)?.modelName ??
    provider.models.find((m) => m.enabled !== false)?.modelName ??
    provider.models[0]?.modelName;

  return modelName ? { provider, modelName } : { provider };
}

export function registerPricingRoutes(
  app: FastifyInstance,
  dataDir: string,
  getConfig: () => ConfigFile,
): void {
  // GET /api/pricing/status — returns the last catalog update time + cached snapshot for the default provider:model (preview).
  app.get("/api/pricing/status", async (request) => {
    const config = getConfig();
    const sourceUrl = config.pricing?.sourceUrl ?? DEFAULT_SOURCE_URL;
    const catalogUpdatedAt = getCatalogUpdatedAt(sourceUrl);
    const { provider, modelName } = resolvePreview(config, request.query as { provider?: string; model?: string });
    let snapshot = null;
    if (provider && modelName) snapshot = getCachedPricing(provider, modelName, config);
    return { catalogUpdatedAt, snapshot: snapshot ?? null };
  });

  // POST /api/pricing/refresh — force a FULL catalog re-download (bypass TTL).
  // No provider:model is required: the whole models.dev catalog is always what
  // gets fetched+stored. A resolved provider:model is only used to also return
  // its fresh snapshot for display.
  app.post("/api/pricing/refresh", async (request) => {
    const config = getConfig();
    const sourceUrl = config.pricing?.sourceUrl ?? DEFAULT_SOURCE_URL;
    try {
      const catalogUpdatedAt = await refreshPricingCatalog(sourceUrl);
      const { provider, modelName } = resolvePreview(config, request.query as { provider?: string; model?: string });
      let snapshot;
      if (provider && modelName) {
        snapshot = await getModelPricing(provider, modelName, config, dataDir);
      }
      return { ok: true, refreshed: true, sourceUrl, catalogUpdatedAt, snapshot: snapshot ?? undefined };
    } catch (err) {
      return { ok: false, refreshed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
