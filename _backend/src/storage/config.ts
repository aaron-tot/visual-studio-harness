import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFile, ProviderConfig } from "../../../_shared/types";
import { ConfigFileSchema } from "../config/schema";

/** Known-good OpenAI-compatible base for OpenCode Zen template. */
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** Old prod defaults pointed at the web app, not the API. */
const LEGACY_ZEN_BASE_URLS = new Set([
  "https://app.opencode.ai/api/chat",
  "https://app.opencode.ai/api/chat/",
  "https://opencode.ai/api/chat",
  "https://opencode.ai/api/chat/",
]);

function normalizeProviders(providers: ProviderConfig[]): { providers: ProviderConfig[]; changed: boolean } {
  let changed = false;
  const next = providers.map((p) => {
    if (p.displayName === "OpenCode Zen" && LEGACY_ZEN_BASE_URLS.has((p.baseUrl || "").trim())) {
      changed = true;
      return { ...p, baseUrl: OPENCODE_ZEN_BASE_URL };
    }
    return p;
  });
  return { providers: next, changed };
}

export async function loadConfig(dataDir: string): Promise<ConfigFile> {
  const filePath = join(dataDir, "config.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const config = ConfigFileSchema.parse(parsed);
    const { providers, changed } = normalizeProviders(config.providers);
    if (changed) {
      const fixed = { ...config, providers };
      await writeFile(filePath, JSON.stringify(fixed, null, 2) + "\n");
      return fixed;
    }
    return config;
  } catch {
    return { providers: [] };
  }
}

export async function saveConfig(dataDir: string, config: ConfigFile): Promise<void> {
  const filePath = join(dataDir, "config.json");
  const valid = ConfigFileSchema.parse(config);
  const { providers } = normalizeProviders(valid.providers);
  const out = { ...valid, providers };
  await writeFile(filePath, JSON.stringify(out, null, 2) + "\n");
}
