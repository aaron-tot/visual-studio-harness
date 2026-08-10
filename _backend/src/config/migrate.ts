import type { AgentSettings, AgentRuntimeSettings, ConfigFile, SearchProviderConfig } from "../../../_shared/types";
import { PRECONFIGURED_PROVIDERS } from "../../../_shared/provider-registry";

/** Migrate legacy agent fields to new structure */
export function migrateConfig(config: ConfigFile): ConfigFile {
  const agents = config.agents ?? {};
  const migrated: Record<string, AgentSettings> = {};

  // Process each agent entry
  for (const [key, value] of Object.entries(agents)) {
    const legacy = value as unknown as AgentRuntimeSettings & { skillMds?: unknown };
    migrated[key] = {
      providerName: legacy.providerName,
      modelName: legacy.modelName,
      temperature: legacy.temperature,
      thinking: legacy.thinking,
      maxSteps: legacy.maxSteps,
      agentMd: (legacy as AgentSettings).agentMd,
      skillMds: Array.isArray(legacy.skillMds) ? legacy.skillMds : [],
    };
  }

  // Backfill testModels if empty — users whose config pre-dates the feature
  let testModels = config.testModels;
  if (!testModels || Object.keys(testModels).length === 0) {
    testModels = {
      model1000: { tokensPerSecond: 250 },
      "model-mixed": { tokensPerSecond: 250 },
      "model-alltools": { tokensPerSecond: 250 },
      toolsV2: { tokensPerSecond: 250 },
      "model-slow": { tokensPerSecond: 50 },
    };
  }

  // Backfill Test provider if missing from providers list
  let providers = config.providers ?? [];
  const hasTestProvider = providers.some((p) => p.test || p.displayName === "Test");
  if (!hasTestProvider) {
    const testDesc = PRECONFIGURED_PROVIDERS.find((d) => d.id === "test");
    if (testDesc) {
      providers = [
        ...providers,
        {
          displayName: testDesc.name,
          baseUrl: testDesc.baseUrl,
          models: testDesc.defaultModels ?? [{ displayName: "Default Model", modelName: "default" }],
          test: true,
        },
      ];
    }
  }

  // Migrate searchProviders from env vars if not present
  let searchProviders = config.searchProviders ?? [];
  if (searchProviders.length === 0) {
    searchProviders = buildDefaultSearchProviders();
  } else {
    // Backfill descriptions for known built-in providers
    searchProviders = searchProviders.map((p) => {
      if (p.id === "exa-primary" && !p.description) {
        return { ...p, description: "Exa MCP — keyless works but rate-limited. Set EXA_API_KEY for higher limits." };
      }
      if (p.id === "parallel-backup" && !p.description) {
        return { ...p, description: "Parallel Search MCP — free/keyless by default. Set PARALLEL_API_KEY for higher limits." };
      }
      return p;
    });
  }

  return {
    ...config,
    workspaceManifest: config.workspaceManifest ?? {},
    providers,
    agents: migrated,
    headless: config.headless ?? false,
    testModels,
    searchProviders,
  };
}

export function buildDefaultSearchProviders(): SearchProviderConfig[] {
  return [
    {
      id: "exa-primary",
      type: "exa",
      name: "Exa Primary",
      // Exa MCP (https://mcp.exa.ai/mcp) works keyless at lower rate limits.
      // API key (EXA_API_KEY) or VISUAL_STUDIO_HARNESS_ENABLE_EXA=1 enables higher limits.
      enabled: true,
      priority: 0,
      apiKey: process.env.EXA_API_KEY,
      tags: ["primary", "batch-rotate"],
      description: "Exa MCP — keyless works but rate-limited. Set EXA_API_KEY for higher limits.",
    },
    {
      id: "parallel-backup",
      type: "parallel",
      name: "Parallel Backup",
      // Parallel Search MCP (https://search.parallel.ai/mcp) is free/keyless by default.
      // API key (PARALLEL_API_KEY) or VISUAL_STUDIO_HARNESS_ENABLE_PARALLEL=1 unlocks higher rate limits.
      enabled: true,
      priority: 1,
      apiKey: process.env.PARALLEL_API_KEY,
      tags: ["fallback", "batch-rotate"],
      description: "Parallel Search MCP — free/keyless by default. Set PARALLEL_API_KEY for higher limits.",
    },
  ];
}
