import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFile, ProviderConfig, SearchProviderConfig, SearchProviderType } from "../../../_shared/types/config";
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
    const config = ConfigFileSchema.parse(parsed) as ConfigFile;
    // Fail loudly when zod strips unknown keys — a key missing from the schema
    // is dead config (silently has no effect). Keeps strip semantics (loading
    // never bricks), but surfaces drift in logs.
    const dropped = Object.keys(parsed).filter((k) => !(k in config));
    if (dropped.length > 0) {
      console.warn(`[config] Dropped unknown key(s) on load: ${dropped.join(", ")}`);
    }
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
