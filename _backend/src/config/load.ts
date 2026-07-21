import { watch, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFile } from "../../../_shared/types";
import { PRECONFIGURED_PROVIDERS } from "../../../_shared/provider-registry";
import { loadConfig, saveConfig } from "../storage/config";
import { migrateConfig } from "./migrate";
import { listAgents, writeAgent } from "../rest/agents";
import { loadSeedJoinersDefaults } from "../features/agents/system-prompt";

export interface ConfigWatcher {
  config: ConfigFile;
  unsubscribe: () => void;
}

export async function initConfigWatcher(
  dataDir: string,
  onChange: (config: ConfigFile) => void,
  mode = "dev"
): Promise<ConfigWatcher> {
  const configPath = join(dataDir, "config.json");

  // Empty placeholder only — session data lives in visual-studio-harness.db, not under here.
  await mkdir(join(dataDir, "sessions"), { recursive: true });

  // Create default config file if it doesn't exist
  if (!existsSync(configPath)) {
    const defaultConfig: ConfigFile = {
      providers: PRECONFIGURED_PROVIDERS.map((d) => ({
        displayName: d.name,
        baseUrl: d.baseUrl,
        models: d.defaultModels ?? [{ displayName: "Default Model", modelName: "default" }],
        ...(d.id === "test" ? { test: true } : {}),
      })),
      defaultProvider: "OpenCode Zen",
      defaultModel: "Default Model",
      agents: {},
      subagent: {
        maxConcurrent: 1,
        slotBusyPolicy: "ask",
        slotPollIntervalSec: 5,
        slotWaitTimeoutSec: 300,
      },
      headless: false,
      testModels: {
        model1000: { tokensPerSecond: 250 },
        "model-mixed": { tokensPerSecond: 250 },
        "model-alltools": { tokensPerSecond: 250 },
        toolsV2: { tokensPerSecond: 250 },
        "model-slow": { tokensPerSecond: 50 },
      },
      systemPromptJoiners: (await loadSeedJoinersDefaults(mode)) ?? {
        start: "",
        afterGlobal: "\n\n",
        afterAgentMd: "\n\n",
        afterSkillMds: "\n\n",
        afterProject: "\n\n",
        afterRuntime: "\n\n",
        afterTodoList: "\n\n",
        afterExtras: "\n\n",
        end: "",
      },
    };
    await saveConfig(dataDir, defaultConfig);
  }

  let config = migrateConfig(await loadConfig(dataDir));

  if (config.agents) {
    const existingFiles = await listAgents(dataDir);
    const fileKeys = new Set(existingFiles.map((a) => a.key));
    for (const [key, settings] of Object.entries(config.agents)) {
      if (!fileKeys.has(key)) {
        await writeAgent(dataDir, key, settings);
      }
    }
  }

  let watcher: ReturnType<typeof watch> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastRaw = "";

  try {
    lastRaw = await Bun.file(configPath).text();
  } catch {
    lastRaw = "";
  }

  const reloadIfChanged = async () => {
    try {
      const raw = await Bun.file(configPath).text();
      if (raw === lastRaw) return;
      lastRaw = raw;
      config = migrateConfig(await loadConfig(dataDir));
      onChange(config);
    } catch {
      // Keep last valid config on parse error
    }
  };

  try {
    watcher = watch(configPath, () => {
      void reloadIfChanged();
    });
  } catch (err) {
    console.error("Config file watch unavailable, falling back to poll:", err);
  }

  // Poll as backup when watch is missing or flaky (e.g. EMFILE)
  pollTimer = setInterval(() => {
    void reloadIfChanged();
  }, 2000);

  return {
    config,
    unsubscribe: () => {
      watcher?.close();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
