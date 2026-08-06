import { describe, it, expect, beforeEach, vi } from "bun:test";
import { SearchProviderRegistry, getSearchProviderRegistry, setSearchProviderRegistry } from "./search-provider-registry";

describe("SearchProviderRegistry", () => {
  let registry: SearchProviderRegistry;

  beforeEach(() => {
    registry = new SearchProviderRegistry();
    setSearchProviderRegistry(registry);
  });

  const makeProvider = (overrides: Partial<{
    id: string;
    type: "exa" | "parallel" | "brave" | "serper" | "custom";
    name: string;
    enabled: boolean;
    priority: number;
    apiKey: string;
    tags: string[];
    rateLimit: { rpm: number };
    customMcpUrl: string;
  }> = {}) => ({
    id: "test-1",
    type: "exa" as const,
    name: "Test Exa",
    enabled: true,
    priority: 0,
    apiKey: "test-key",  // pragma: allowlist secret
    tags: ["primary", "batch-rotate"],
    rateLimit: { rpm: 60 },
    ...overrides,
  });

  it("registers and retrieves providers sorted by priority", () => {
    registry.register(makeProvider({ id: "p1", priority: 2 }));
    registry.register(makeProvider({ id: "p2", priority: 0 }));
    registry.register(makeProvider({ id: "p3", priority: 1 }));

    const all = registry.getAll();
    expect(all.map(p => p.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("getPrimary returns lowest priority enabled provider", () => {
    registry.register(makeProvider({ id: "p1", priority: 1, enabled: false }));
    registry.register(makeProvider({ id: "p2", priority: 0, enabled: true }));
    registry.register(makeProvider({ id: "p3", priority: 2, enabled: true }));

    expect(registry.getPrimary()?.id).toBe("p2");
  });

  it("getPrimary returns null when none enabled", () => {
    registry.register(makeProvider({ id: "p1", priority: 0, enabled: false }));
    registry.register(makeProvider({ id: "p2", priority: 1, enabled: false }));

    expect(registry.getPrimary()).toBeNull();
  });

  it("getFallbacks returns enabled providers with priority > 0", () => {
    registry.register(makeProvider({ id: "p1", priority: 0, enabled: true }));
    registry.register(makeProvider({ id: "p2", priority: 1, enabled: true }));
    registry.register(makeProvider({ id: "p3", priority: 2, enabled: false }));
    registry.register(makeProvider({ id: "p4", priority: 3, enabled: true }));

    const fallbacks = registry.getFallbacks();
    expect(fallbacks.map(p => p.id)).toEqual(["p2", "p4"]);
  });

  it("getBatchRotation returns providers with batch-rotate tag", () => {
    registry.register(makeProvider({ id: "p1", priority: 0, tags: ["primary", "batch-rotate"] }));
    registry.register(makeProvider({ id: "p2", priority: 1, tags: ["fallback"] }));
    registry.register(makeProvider({ id: "p3", priority: 2, tags: ["fallback", "batch-rotate"] }));

    const rotation = registry.getBatchRotation();
    expect(rotation.map(p => p.id)).toEqual(["p1", "p3"]);
  });

  it("getById returns exact match", () => {
    registry.register(makeProvider({ id: "specific-id" }));
    expect(registry.getById("specific-id")?.name).toBe("Test Exa");
    expect(registry.getById("missing")).toBeUndefined();
  });

  it("getProviderForCall with explicitId returns that provider if enabled", () => {
    registry.register(makeProvider({ id: "explicit", enabled: true }));
    registry.register(makeProvider({ id: "other", enabled: true }));

    expect(registry.getProviderForCall({ explicitId: "explicit" })?.id).toBe("explicit");
    expect(registry.getProviderForCall({ explicitId: "missing" })).toBeNull();
    expect(registry.getProviderForCall({ explicitId: "other", batchRotation: true })?.id).toBe("other");
  });

  it("getProviderForCall with batchRotation rotates through tagged providers", () => {
    registry.register(makeProvider({ id: "r1", priority: 0, tags: ["batch-rotate"] }));
    registry.register(makeProvider({ id: "r2", priority: 1, tags: ["batch-rotate"] }));
    registry.register(makeProvider({ id: "r3", priority: 2, tags: ["batch-rotate"] }));

    expect(registry.getProviderForCall({ batchRotation: true })?.id).toBe("r1");
    expect(registry.getProviderForCall({ batchRotation: true })?.id).toBe("r2");
    expect(registry.getProviderForCall({ batchRotation: true })?.id).toBe("r3");
    expect(registry.getProviderForCall({ batchRotation: true })?.id).toBe("r1"); // wraps
  });

  it("getProviderForCall with batchRotation falls back to primary when no tagged providers", () => {
    registry.register(makeProvider({ id: "p1", priority: 0, tags: ["primary"] }));
    registry.register(makeProvider({ id: "p2", priority: 1, tags: ["fallback"] }));

    expect(registry.getProviderForCall({ batchRotation: true })?.id).toBe("p1");
  });

  it("getProviderForCall without options returns primary", () => {
    registry.register(makeProvider({ id: "p1", priority: 0 }));
    registry.register(makeProvider({ id: "p2", priority: 1 }));

    expect(registry.getProviderForCall({})?.id).toBe("p1");
  });

  it("setAll replaces all providers but preserves rate limit buckets", () => {
    registry.register(makeProvider({ id: "old", priority: 0 }));
    registry.consumeToken("old"); // drain bucket

    registry.setAll([makeProvider({ id: "new", priority: 0 })]);

    expect(registry.getAll().map(p => p.id)).toEqual(["new"]);
    // old bucket should be gone since provider removed
    expect(registry.isRateLimited("old")).toBe(false);
  });

  it("unregister removes provider and its rate limit state", () => {
    registry.register(makeProvider({ id: "to-delete" }));
    registry.consumeToken("to-delete");
    registry.unregister("to-delete");

    expect(registry.getById("to-delete")).toBeUndefined();
    expect(registry.isRateLimited("to-delete")).toBe(false);
  });

  describe("rate limiting", () => {
    it("consumeToken allows up to capacity", () => {
      registry.register(makeProvider({ id: "rl-1", rateLimit: { rpm: 10 } }));
      for (let i = 0; i < 10; i++) {
        expect(registry.consumeToken("rl-1")).toBe(true);
      }
      expect(registry.consumeToken("rl-1")).toBe(false);
    });

    it("isRateLimited returns true when tokens exhausted", () => {
      registry.register(makeProvider({ id: "rl-2", rateLimit: { rpm: 5 } }));
      for (let i = 0; i < 5; i++) registry.consumeToken("rl-2");
      expect(registry.isRateLimited("rl-2")).toBe(true);
    });

    it("markRateLimited drains bucket immediately", () => {
      registry.register(makeProvider({ id: "rl-3", rateLimit: { rpm: 100 } }));
      registry.markRateLimited("rl-3");
      expect(registry.isRateLimited("rl-3")).toBe(true);
    });

    it("bucket refills over time", async () => {
      vi.useFakeTimers();
      registry.register(makeProvider({ id: "rl-4", rateLimit: { rpm: 60 } })); // 1 per second
      for (let i = 0; i < 60; i++) registry.consumeToken("rl-4");
      expect(registry.isRateLimited("rl-4")).toBe(true);

      vi.advanceTimersByTime(2000); // 2 seconds
      expect(registry.isRateLimited("rl-4")).toBe(false);
      expect(registry.consumeToken("rl-4")).toBe(true);

      vi.useRealTimers();
    });

    it("unknown provider is not rate limited", () => {
      expect(registry.isRateLimited("unknown")).toBe(false);
      expect(registry.consumeToken("unknown")).toBe(true);
    });
  });

  describe("MCP URL building", () => {
    it("builds Exa URL with API key from provider", () => {
      const provider = makeProvider({ type: "exa", apiKey: "exa-key-123" });
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("exaApiKey=exa-key-123");
      expect(url).toContain("mcp.exa.ai");
    });

    it("builds Exa URL without key falls back to env", () => {
      const provider = makeProvider({ type: "exa", apiKey: undefined });
      process.env.EXA_API_KEY = "env-exa-key";  // pragma: allowlist secret
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("exaApiKey=env-exa-key");
      delete process.env.EXA_API_KEY;
    });

    it("builds Parallel URL with API key in query", () => {
      const provider = makeProvider({ type: "parallel", apiKey: "parallel-key" });
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("apiKey=parallel-key");
      expect(url).toContain("search.parallel.ai");
    });

    it("builds Brave URL with subscription token", () => {
      const provider = makeProvider({ type: "brave", apiKey: "brave-key" });
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("apiKey=brave-key");
      expect(url).toContain("api.search.brave.com");
    });

    it("builds Serper URL with API key", () => {
      const provider = makeProvider({ type: "serper", apiKey: "serper-key" });
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("apiKey=serper-key");
      expect(url).toContain("mcp.serper.dev");
    });

    it("builds Custom URL with apiKey as query param", () => {
      const provider = makeProvider({ type: "custom", apiKey: "custom-key", customMcpUrl: "https://custom.example.com/mcp" });
      registry.register(provider);
      const url = registry.buildMcpUrl(provider);
      expect(url).toContain("apiKey=custom-key");
      expect(url).toContain("custom.example.com");
    });

    it("throws on custom without customMcpUrl", () => {
      const provider = makeProvider({ type: "custom", customMcpUrl: undefined });
      registry.register(provider);
      expect(() => registry.buildMcpUrl(provider)).toThrow("missing customMcpUrl");
    });
  });

  describe("MCP tool names and args", () => {
    it("returns correct tool name for Exa", () => {
      expect(registry.getMcpToolName("exa")).toBe("web_search_exa");
    });

    it("returns web_search for other types", () => {
      expect(registry.getMcpToolName("parallel")).toBe("web_search");
      expect(registry.getMcpToolName("brave")).toBe("web_search");
      expect(registry.getMcpToolName("serper")).toBe("web_search");
      expect(registry.getMcpToolName("custom")).toBe("web_search");
    });

    it("builds Exa-specific args", () => {
      const args = registry.buildMcpArgs("exa", "test query", { type: "deep", numResults: 5 });
      expect(args.query).toBe("test query");
      expect(args.type).toBe("deep");
      expect(args.numResults).toBe(5);
      expect(args.livecrawl).toBe("fallback");
    });

    it("builds generic args for other types", () => {
      const args = registry.buildMcpArgs("parallel", "test query");
      expect(args.objective).toBe("test query");
      expect(args.search_queries).toEqual(["test query"]);
    });
  });
});
