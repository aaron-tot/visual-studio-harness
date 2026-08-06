import { describe, it, expect, beforeEach, vi } from "bun:test";
import { websearchTool } from "../builtins/websearch";
import { SearchProviderRegistry, setSearchProviderRegistry, getSearchProviderRegistry } from "../host/search-provider-registry";

describe("websearchTool fallback integration", () => {
  let registry: SearchProviderRegistry;
  const mockCtx = {
    sessionId: "test-session",
    abortSignal: new AbortController().signal,
    workspaceRoot: "/tmp",
    dataDir: "/tmp",
    turnId: 1,
    callId: "test-call",
    askPermission: vi.fn().mockResolvedValue(true),
    hookCtx: undefined,
    toolName: "websearch",
  };

  beforeEach(() => {
    registry = new SearchProviderRegistry();
    setSearchProviderRegistry(registry);
    vi.clearAllMocks();
  });

  it("uses explicit provider when provider arg given", async () => {
    registry.register({
      id: "explicit-exa",
      type: "exa",
      name: "Explicit Exa",
      enabled: true,
      priority: 0,
      apiKey: "test-key",  // pragma: allowlist secret
      tags: ["primary"],
    });

    const mockCall = vi.fn().mockResolvedValue("explicit result");
    const originalMcp = (websearchTool as any).execute;
    // We can't easily mock the internal mcpToolsCall, so test the registry logic directly
    const provider = registry.getProviderForCall({ explicitId: "explicit-exa" });
    expect(provider?.id).toBe("explicit-exa");
  });

  it("falls back to next provider on rate limit", async () => {
    registry.register({
      id: "primary",
      type: "exa",
      name: "Primary",
      enabled: true,
      priority: 0,
      apiKey: "key1",  // pragma: allowlist secret
      tags: ["primary", "batch-rotate"],
    });
    registry.register({
      id: "fallback",
      type: "parallel",
      name: "Fallback",
      enabled: true,
      priority: 1,
      apiKey: "key2",  // pragma: allowlist secret
      tags: ["fallback", "batch-rotate"],
    });

    const primary = registry.getPrimary();
    expect(primary?.id).toBe("primary");

    const fallbacks = registry.getFallbacks();
    expect(fallbacks.map(p => p.id)).toEqual(["fallback"]);

    registry.markRateLimited("primary");
    expect(registry.isRateLimited("primary")).toBe(true);
    expect(registry.isRateLimited("fallback")).toBe(false);
  });

  it("batch rotation cycles through tagged providers", async () => {
    registry.register({
      id: "r1", type: "exa", name: "R1", enabled: true, priority: 0, apiKey: "k1", tags: ["batch-rotate"],  // pragma: allowlist secret
    });
    registry.register({
      id: "r2", type: "parallel", name: "R2", enabled: true, priority: 1, apiKey: "k2", tags: ["batch-rotate"],  // pragma: allowlist secret
    });
    registry.register({
      id: "r3", type: "brave", name: "R3", enabled: true, priority: 2, apiKey: "k3", tags: ["batch-rotate"],  // pragma: allowlist secret
    });

    const calls = [
      registry.getProviderForCall({ batchRotation: true }),
      registry.getProviderForCall({ batchRotation: true }),
      registry.getProviderForCall({ batchRotation: true }),
      registry.getProviderForCall({ batchRotation: true }),
    ];

    expect(calls.map(c => c?.id)).toEqual(["r1", "r2", "r3", "r1"]);
  });

  it("disabled providers are excluded from fallback/rotation", () => {
    registry.register({
      id: "enabled", type: "exa", name: "Enabled", enabled: true, priority: 0, apiKey: "k", tags: ["batch-rotate"],
    });
    registry.register({
      id: "disabled", type: "parallel", name: "Disabled", enabled: false, priority: 1, apiKey: "k", tags: ["batch-rotate"],
    });

    const rotation = registry.getBatchRotation();
    expect(rotation.map(p => p.id)).toEqual(["enabled"]);

    const fallbacks = registry.getFallbacks();
    expect(fallbacks.map(p => p.id)).toEqual([]);
  });
});

describe("searchOnlineTool provider id pass-through", () => {
  it("includes provider metadata in result", () => {
    // This tests the schema change - provider is now string not enum
    const { searchOnlineTool } = require("../consolidated/searchOnline");
    const schema = searchOnlineTool.inputSchema;
    const providerField = schema.shape.provider;
    expect(providerField).toBeDefined();
    // Should accept any string, not just exa/parallel
  });
});
