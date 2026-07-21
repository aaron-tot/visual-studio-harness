import type { AgentSettings, AgentRuntimeSettings, ConfigFile } from "../../../_shared/types";
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

  return {
    ...config,
    providers,
    agents: migrated,
    headless: config.headless ?? false,
    testModels,
  };
}
