import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getModelPricing,
  refreshModelPricing,
  refreshPricingCatalog,
  getCachedPricing,
  resolveModelsDevProviderId,
  resetPricingCache,
  initPricingCache,
} from "./models-dev";
import { computeCostUsd } from "../../../../_shared/types/config";
import type { ProviderConfig, PricingSnapshot, PricingTokenInput } from "../../../../_shared/types/config";

describe("pricing: models-dev", () => {
  const mockProvider: ProviderConfig = {
    displayName: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    models: [{ displayName: "nemotron-3-ultra-free", modelName: "nemotron-3-ultra-free", enabled: true }],
  };

  const mockConfig = {
    pricing: {
      sourceUrl: "https://models.dev/api.json",
      cacheTtlMinutes: 60,
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveModelsDevProviderId", () => {
    it("returns explicit override", () => {
      const p = { ...mockProvider, pricingProviderId: "custom-id" };
      expect(resolveModelsDevProviderId(p)).toBe("custom-id");
    });

    it("returns builtin map for OpenCode Zen", () => {
      expect(resolveModelsDevProviderId(mockProvider)).toBe("opencode");
    });

    it("returns builtin map for OpenCode Go", () => {
      const p = { ...mockProvider, displayName: "OpenCode Go" };
      expect(resolveModelsDevProviderId(p)).toBe("opencode-go");
    });

    it("returns builtin map for OpenRouter", () => {
      const p = { ...mockProvider, displayName: "OpenRouter" };
      expect(resolveModelsDevProviderId(p)).toBe("openrouter");
    });

    it("returns builtin map for Ollama", () => {
      const p = { ...mockProvider, displayName: "Ollama" };
      expect(resolveModelsDevProviderId(p)).toBe("ollama");
    });

    it("returns null for localhost provider", () => {
      const p = { ...mockProvider, baseUrl: "http://localhost:11434/v1" };
      expect(resolveModelsDevProviderId(p)).toBeNull();
    });

    it("returns null for test provider", () => {
      const p = { ...mockProvider, test: true };
      expect(resolveModelsDevProviderId(p)).toBeNull();
    });

    it("returns null for unknown provider", () => {
      const p = { ...mockProvider, displayName: "UnknownProvider", baseUrl: "https://example.com" };
      expect(resolveModelsDevProviderId(p)).toBeNull();
    });
  });

  describe("computeCostUsd", () => {
    const baseSnapshot: PricingSnapshot = {
      providerId: "opencode",
      providerDisplayName: "OpenCode Zen",
      modelId: "test-model",
      found: true,
      sourceUrl: "https://models.dev/api.json",
      fetchedAt: new Date().toISOString(),
      rates: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
      tiers: [{ size: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 }],
      contextOver200K: { input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
      limitContext: 1_000_000,
    };

    it("returns null when found:false", () => {
      const snap = { ...baseSnapshot, found: false };
      const tokens: PricingTokenInput = { inputTokens: 1000, outputTokens: 500 };
      expect(computeCostUsd(tokens, snap)).toBeNull();
    });

    it("computes cost with base rates (no cache, no reasoning)", () => {
      // Use inputTokens < tier size (200k) to test base rates
      const tokens: PricingTokenInput = { inputTokens: 100_000, outputTokens: 50_000 };
      // (100k/1M)*3 + (50k/1M)*15 = 0.3 + 0.75 = 1.05
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(1.05, 5);
    });

    it("computes cost with cache read/write", () => {
      // Use inputTokens < tier size (200k) to test base rates
      const tokens: PricingTokenInput = {
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 5_000,
      };
      // noCacheInput = 100k - 10k - 5k = 85k
      // (85k/1M)*3 + (50k/1M)*15 + (10k/1M)*0.3 + (5k/1M)*3.75
      // = 0.255 + 0.75 + 0.003 + 0.01875 = 1.02675
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(1.02675, 5);
    });

    it("computes cost with reasoning tokens (charged at output rate)", () => {
      // Use inputTokens < tier size (200k) to test base rates
      const tokens: PricingTokenInput = {
        inputTokens: 100_000,
        outputTokens: 50_000,
        reasoningTokens: 10_000,
      };
      // normalOutput = 50k - 10k = 40k
      // (100k/1M)*3 + (40k/1M)*15 + (10k/1M)*15 = 0.3 + 0.6 + 0.15 = 1.05
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(1.05, 5);
    });

    it("selects tier rate when inputTokens > tier size", () => {
      // 250k input > 200k tier
      const tokens: PricingTokenInput = { inputTokens: 250_000, outputTokens: 100_000 };
      // tier: input=6, output=22.5
      // (250k/1M)*6 + (100k/1M)*22.5 = 1.5 + 2.25 = 3.75
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(3.75, 5);
    });

    it("uses contextOver200K when inputTokens > 200k and no tier matches", () => {
      // No tier < 250k, so use contextOver200K
      const snap = { ...baseSnapshot, tiers: [] };
      const tokens: PricingTokenInput = { inputTokens: 250_000, outputTokens: 100_000 };
      // contextOver200K: input=6, output=22.5
      // (250k/1M)*6 + (100k/1M)*22.5 = 1.5 + 2.25 = 3.75
      expect(computeCostUsd(tokens, snap)).toBeCloseTo(3.75, 5);
    });

    it("uses noCacheInputTokens when provided", () => {
      const tokens: PricingTokenInput = {
        inputTokens: 100_000,
        outputTokens: 50_000,
        noCacheInputTokens: 80_000, // explicit
        cacheReadTokens: 10_000,
        cacheWriteTokens: 10_000,
      };
      // Uses explicit noCacheInputTokens (80k) instead of computed
      // (80k/1M)*3 + (50k/1M)*15 + (10k/1M)*0.3 + (10k/1M)*3.75 = 0.24 + 0.75 + 0.003 + 0.0375 = 1.0305
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(1.0305, 5);
    });

    it("handles missing optional token fields", () => {
      const tokens: PricingTokenInput = { inputTokens: 1000 };
      // (1000/1M)*3 = 0.003
      expect(computeCostUsd(tokens, baseSnapshot)).toBeCloseTo(0.003, 5);
    });
  });

  describe("cache behavior (stubbed fetch)", () => {
    const provider: ProviderConfig = {
      displayName: "OpenCode Zen",
      baseUrl: "https://opencode.ai/zen/v1",
      models: [
        { displayName: "model-a", modelName: "model-a", enabled: true },
        { displayName: "model-b", modelName: "model-b", enabled: true },
        { displayName: "missing-model", modelName: "missing-model", enabled: true },
      ],
    };

    const catalog = {
      opencode: {
        models: {
          "model-a": { cost: { input: 3, output: 15 }, limit: { context: 1000000 } },
          "model-b": { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 }, limit: { context: 2000000 } },
        },
      },
    };

    let fetchMock: (input?: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    const originalFetch = globalThis.fetch;

    // Each test uses a unique sourceUrl so the persisted-on-disk catalog from a
    // prior/other test (a fresh fallback) never satisfies a lookup — forcing the
    // mock `fetch` to be the only source.
    let urlSeq = 0;
    const nextSourceUrl = () => `https://models.dev/api.test-${Date.now()}-${urlSeq++}`;

    const stubFetch = (fail = false) => {
      fetchMock = vi.fn(async () => {
        if (fail) throw new Error("network down");
        return { ok: true, json: async () => catalog };
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    };

    beforeEach(() => {
      resetPricingCache();
      stubFetch();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      resetPricingCache();
    });

    it("shares the catalog across models within the TTL (one fetch)", async () => {
      const cfg = { pricing: { enabled: true, cacheTtlMinutes: 60, sourceUrl: nextSourceUrl() } };
      const a = await getModelPricing(provider, "model-a", cfg);
      const b = await getModelPricing(provider, "model-b", cfg);
      expect(a.found).toBe(true);
      expect(b.found).toBe(true);
      // Both lookups served by a single catalog download
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refetches the catalog after TTL expiry (TTL=0)", async () => {
      const cfg = { pricing: { enabled: true, cacheTtlMinutes: 0, sourceUrl: nextSourceUrl() } };
      await getModelPricing(provider, "model-a", cfg);
      await getModelPricing(provider, "model-a", cfg);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("caches found:false within the negative TTL (no refetch)", async () => {
      const cfg = { pricing: { enabled: true, cacheTtlMinutes: 60, sourceUrl: nextSourceUrl() } };
      const first = await getModelPricing(provider, "missing-model", cfg);
      const second = await getModelPricing(provider, "missing-model", cfg);
      expect(first.found).toBe(false);
      expect(second.found).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refreshModelPricing bypasses the TTL and re-downloads", async () => {
      const cfg = { pricing: { enabled: true, cacheTtlMinutes: 60, sourceUrl: nextSourceUrl() } };
      await getModelPricing(provider, "model-a", cfg);
      await refreshModelPricing(provider, "model-a", cfg);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("refreshPricingCatalog forces a full catalog re-download (one fetch for any model)", async () => {
      const cfg = { pricing: { enabled: true, cacheTtlMinutes: 60, sourceUrl: nextSourceUrl() } };
      await getModelPricing(provider, "model-a", cfg); // fetch #1, catalog cached
      await refreshPricingCatalog(cfg.pricing!.sourceUrl); // force re-download (fetch #2)
      await getModelPricing(provider, "model-b", cfg); // served from fresh catalog
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
