import { create } from "zustand";
import type { ConfigFile } from "../../_shared/types";
import { getConfig, updateConfig as apiUpdateConfig, listAgents } from "../lib/api";
import { wsClient } from "../lib/ws";

interface ConfigState {
  config: ConfigFile;
  loading: boolean;
  fetch: () => Promise<void>;
  update: (config: ConfigFile) => Promise<void>;
  setConfig: (config: ConfigFile) => void;
}

async function mergeAgentFiles(config: ConfigFile): Promise<ConfigFile> {
  try {
    const files = await listAgents();
    const merged = { ...config.agents ?? {} };
    for (const file of files) {
      merged[file.key] = { ...merged[file.key], ...file.settings };
    }
    return { ...config, agents: merged };
  } catch {
    return config;
  }
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: { providers: [] },
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      let config = await getConfig();
      config = await mergeAgentFiles(config);
      set({ config, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  update: async (config) => {
    await apiUpdateConfig(config);
    set({ config });
  },
  setConfig: (config) => set({ config }),
}));

wsClient.on("config_updated", async (data: any) => {
  if (data.config) {
    const config = await mergeAgentFiles(data.config);
    useConfigStore.setState({ config });
  }
});
