import type {
  AgentSettings,
  ConfigFile,
  ModelConfig,
  ProviderConfig,
  SessionMeta,
  SubagentToolSettings,
  ThinkingEffort,
} from "../../../_shared/types";
import { readAgent } from "./rest";

export interface ResolvedRuntime {
  settings: AgentSettings;
  provider: ProviderConfig;
  model: ModelConfig;
  temperature?: number;
  thinkingEffort: ThinkingEffort;
  maxSteps: number;
  maxConcurrent: number;
}

/** Fill in defaults for agent settings, falling back to config-level defaults. */
export function getAgentSettings(
  settings: AgentSettings,
  config: ConfigFile
): AgentSettings {
  return {
    providerName: settings.providerName ?? config.defaultProvider,
    modelName: settings.modelName ?? config.defaultModel,
    temperature: settings.temperature,
    thinking: settings.thinking ?? { effort: "off" },
    maxSteps: settings.maxSteps ?? 30,
    agentMd: settings.agentMd,
    skillMds: settings.skillMds ?? [],
  };
}

/** Get agent settings for any agent key (built-in or custom) */
export function getCustomAgentSettings(
  config: ConfigFile,
  key: string,
): AgentSettings | undefined {
  return config.agents?.[key];
}

/** Resolve runtime from any AgentSettings (for custom agents) */
export function resolveRuntimeFromSettings(
  settings: AgentSettings,
  providers: ProviderConfig[],
): ResolvedRuntime {
  const wantProvider = settings.providerName;

  let provider = wantProvider
    ? providers.find((p) => p.displayName === wantProvider)
    : undefined;
  if (!provider) {
    provider = providers.find((p) => p.enabled !== false) ?? providers[0];
  }
  if (!provider) {
    throw new Error("Provider not found");
  }

  const wantModel = settings.modelName;
  let model = wantModel
    ? provider.models.find((m) => m.displayName === wantModel)
    : undefined;
  if (!model) {
    model = provider.models.find((m) => m.enabled !== false) ?? provider.models[0];
  }
  if (!model) {
    throw new Error("Model not found");
  }

  const maxSteps =
    settings.maxSteps ?? 30;
  const thinkingEffort: ThinkingEffort = settings.thinking?.effort ?? "off";

  return {
    settings,
    provider,
    model,
    temperature: settings.temperature,
    thinkingEffort,
    maxSteps,
    maxConcurrent: 1,
  };
}

/** Resolve runtime from session metadata + agent file overrides. */
export async function resolveSessionRuntime(
  dataDir: string,
  sessionMeta: SessionMeta,
  config: ConfigFile
): Promise<ResolvedRuntime> {
  // Start with agent settings as base (if agent is selected)
  let agentSettings: AgentSettings = {};
  if (sessionMeta.agentName) {
    const agent = await readAgent(dataDir, sessionMeta.agentName);
    if (agent) {
      agentSettings = agent;
    }
  }

  // Session meta's model/thinking take precedence over agent settings
  // (user can override via dropdowns), but agent's other settings apply
  let merged: AgentSettings = {
    ...agentSettings,
    providerName: sessionMeta.providerName ?? agentSettings.providerName ?? config.defaultProvider,
    modelName: sessionMeta.modelName ?? agentSettings.modelName ?? config.defaultModel,
    thinking: sessionMeta.thinkingEffort
      ? { effort: sessionMeta.thinkingEffort }
      : agentSettings.thinking ?? { effort: "off" },
  };

  merged = getAgentSettings(merged, config);
  return resolveRuntimeFromSettings(merged, config.providers);
}

/** Get global subagent tool settings from config */
export function getSubagentSettings(config: ConfigFile): SubagentToolSettings {
  return config.subagent ?? {};
}
