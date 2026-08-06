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
  let providers = config.providers;
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
  let searchProviders = config.searchProviders;
  if (!searchProviders || searchProviders.length === 0) {
    searchProviders = buildDefaultSearchProviders();
  }

  return {
    ...config,
    workspaceManifest: config.workspaceManifest ?? { enabled: true },
    providers,
    agents: migrated,
    headless: config.headless ?? false,
    testModels,
    searchProviders,
  };
}

function buildDefaultSearchProviders(): SearchProviderConfig[] {
  const providers: SearchProviderConfig[] = [];

  // Exa from env
  if (process.env.EXA_API_KEY || process.env.VISUAL_STUDIO_HARNESS_ENABLE_EXA) {
    providers.push({
      id: "exa-primary",
      type: "exa",
      name: "Exa Primary",
      enabled: true,
      priority: 0,
      apiKey: process.env.EXA_API_KEY,
      tags: ["primary", "batch-rotate"],
    });
  }

  // Parallel from env
  if (process.env.PARALLEL_API_KEY || process.env.VISUAL_STUDIO_HARNESS_ENABLE_PARALLEL) {
    providers.push({
      id: "parallel-backup",
      type: "parallel",
      name: "Parallel Backup",
      enabled: true,
      priority: providers.length > 0 ? 1 : 0,
      apiKey: process.env.PARALLEL_API_KEY,
      tags: providers.length > 0 ? ["fallback", "batch-rotate"] : ["primary", "batch-rotate"],
    });
  }

  // If neither configured, create defaults (disabled) so UI shows them
  if (providers.length === 0) {
    providers.push(
      {
        id: "exa-primary",
        type: "exa",
        name: "Exa Primary",
        enabled: false,
        priority: 0,
        tags: ["primary", "batch-rotate"],
      },
      {
        id: "parallel-backup",
        type: "parallel",
        name: "Parallel Backup",
        enabled: false,
        priority: 1,
        tags: ["fallback", "batch-rotate"],
      }
    );
  }

  return providers;
}
