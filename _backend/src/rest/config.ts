import type { FastifyInstance } from "fastify";
import type { ConfigFile } from "../../../_shared/types";
import { loadConfig, saveConfig } from "../storage/config";
import { migrateConfig } from "../config/migrate";
import { broadcastConfig } from "../ws/configPush";
import { serverOriginFromBaseUrl } from "../llm/slots";
import { getSearchProviderRegistry } from "../features/tools/host/search-provider-registry";
import { getModelPricing, refreshModelPricing } from "../features/pricing/models-dev";

function buildProviderHeaders(provider: { type: string; apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "VisualStudioHarness/websearch-test",
  };

  if (provider.type === "parallel" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  } else if (provider.type === "brave" && provider.apiKey) {
    headers["X-Subscription-Token"] = provider.apiKey;
  } else if (provider.type === "serper" && provider.apiKey) {
    headers["X-API-KEY"] = provider.apiKey;
  } else if (provider.type === "custom" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function parseMcpTestResponse(body: string): string | undefined {
  const tryParse = (payload: string): string | undefined => {
    const trimmed = payload.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      const data = JSON.parse(trimmed) as {
        result?: { content?: Array<{ type?: string; text?: string }> };
        error?: { message?: string };
      };
      if (data.error?.message) {
        throw new Error(data.error.message);
      }
      const content = data.result?.content;
      if (!Array.isArray(content)) return undefined;
      const text = content.find((c) => typeof c.text === "string")?.text;
      return text;
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.includes("JSON")) {
        throw e;
      }
      return undefined;
    }
  };

  const direct = tryParse(body);
  if (direct) return direct;

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const hit = tryParse(line.slice(6));
    if (hit) return hit;
  }
  return undefined;
}

export function registerConfigRoutes(
  app: FastifyInstance,
  dataDir: string,
  getConfig: () => ConfigFile,
  setConfig: (config: ConfigFile) => void
) {
  // Always re-read from disk so external edits work even if fs.watch fails (EMFILE, etc.)
  app.get("/api/config", async () => {
    try {
      const fromDisk = migrateConfig(await loadConfig(dataDir));
      setConfig(fromDisk);
      return fromDisk;
    } catch {
      return getConfig();
    }
  });

  app.put("/api/config", async (request, reply) => {
    const config = migrateConfig(request.body as ConfigFile);
    await saveConfig(dataDir, config);
    setConfig(config);
    broadcastConfig(config);
    return { ok: true };
  });

  app.post("/api/search-providers/test", async (request, reply) => {
    const { providerId } = request.body as { providerId: string };
    if (!providerId) {
      return reply.code(400).send({ error: "providerId is required" });
    }

    const registry = getSearchProviderRegistry();
    const provider = registry.getById(providerId);
    if (!provider) {
      return reply.code(404).send({ error: "Provider not found" });
    }
    if (!provider.enabled) {
      return reply.code(400).send({ error: "Provider is disabled" });
    }

    try {
      const url = registry.buildMcpUrl(provider);
      const toolName = registry.getMcpToolName(provider.type);
      const toolArgs = registry.buildMcpArgs(provider.type, "test query", {
        numResults: 3,
      });
      const headers = buildProviderHeaders(provider);

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: toolName, arguments: toolArgs },
        }),
        signal: ac.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return reply.code(502).send({
          success: false,
          error: `HTTP ${res.status}: ${errBody.slice(0, 200)}`,
          provider: provider.name,
        });
      }

      const body = await res.text();
      const text = parseMcpTestResponse(body);

      return {
        success: true,
        provider: provider.name,
        providerId: provider.id,
        result: text?.slice(0, 500) || "No results returned",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aborted") || msg.includes("timeout")) {
        return reply.code(504).send({
          success: false,
          error: "Request timed out (10s)",
          provider: provider.name,
        });
      }
      return reply.code(502).send({
        success: false,
        error: msg.slice(0, 200),
        provider: provider.name,
      });
    }
  });

  app.get("/api/providers/:index/models", async (request, reply) => {
    const { index } = request.params as { index: string };
    // Prefer fresh disk config (after Save & Connect) over in-memory snapshot
    let provider = getConfig().providers[parseInt(index, 10)];
    try {
      const fromDisk = migrateConfig(await loadConfig(dataDir));
      setConfig(fromDisk);
      provider = fromDisk.providers[parseInt(index, 10)];
    } catch {
      // keep in-memory
    }
    if (!provider) return reply.code(404).send({ error: "Provider not found" });
    if (!provider.baseUrl?.trim()) {
      return reply.code(400).send({ error: "Provider base URL is empty" });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;

    const url = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
    let res: Response;
    let providerAlive = false;
    try {
      res = await fetch(url, { headers });
      providerAlive = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Provider ${index}] ${provider.displayName}: cannot reach ${url} — ${msg}`);
      return reply.code(502).send({ error: `Failed to reach ${url}: ${msg}`, providerAlive: false });
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return reply.code(502).send({
        error:
          `Invalid JSON from ${url} (HTTP ${res.status}). ` +
          `For OpenCode Zen use baseUrl https://opencode.ai/zen/v1 (OpenAI-compatible), ` +
          `not the web app URL. Body starts with: ${text.slice(0, 120).replace(/\s+/g, " ")}`,
        providerAlive: true,
      });
    }

    const list = (data && typeof data === "object" && "data" in data
      ? (data as { data: unknown }).data
      : data) as unknown;
    const arr = Array.isArray(list) ? list : [];
    const origin = serverOriginFromBaseUrl(provider.baseUrl);

    // Check model running status via read-only endpoints that don't trigger loads.
    // Priority: status field in /v1/models response (llama-swap) > /running (llama-swap)
    let runningModels: Set<string> | undefined;

    // llama-swap embeds status in /v1/models: { data: [{ id, status: { value: "loaded" } }, ...] }
    const hasModelStatus = arr.some(
      (m): boolean => !!m && typeof m === "object" && "status" in (m as object)
    );

    if (!hasModelStatus && origin) {
      // /running is read-only — won't start models
      try {
        const runningRes = await fetch(`${origin}/running`, {
          signal: AbortSignal.timeout(3000),
        });
        if (runningRes.ok) {
          const runningData = (await runningRes.json()) as {
            running?: Array<{ model?: string; state?: string }>;
          };
          if (runningData.running) {
            runningModels = new Set(
              runningData.running
                .filter((m) => m.state === "ready" || m.state === "starting")
                .map((m) => m.model)
                .filter((m): m is string => !!m)
            );
          }
        }
      } catch {
        // /running is optional
      }
    }

    const models = arr
      .filter((m): m is { id: string } => !!m && typeof m === "object" && "id" in m && !!(m as { id: unknown }).id)
      .map((m) => {
        const id = String(m.id);
        const entry = m as { status?: { value?: string } };
        let isLoaded: boolean | undefined;
        if (hasModelStatus) {
          isLoaded = entry.status?.value === "loaded" ? true : entry.status?.value === "unloaded" ? false : undefined;
        } else if (runningModels) {
          isLoaded = runningModels.has(id);
        }
        const base = {
          displayName: id,
          modelName: id,
          enabled: true,
          isLoaded,
        };
        // Preserve per-model routing on refresh (match by modelName) so a
        // "Save & Connect" fetch doesn't wipe providerOrder/allowProviderFallbacks.
        const existing = provider.models.find((m0) => m0.modelName === id);
        if (existing && (existing.providerOrder || existing.allowProviderFallbacks !== undefined)) {
          return {
            ...base,
            providerOrder: existing.providerOrder,
            allowProviderFallbacks: existing.allowProviderFallbacks,
          };
        }
        return base;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    if (!res.ok) {
      return reply.code(502).send({
        error: `Upstream ${url} returned HTTP ${res.status}`,
        models,
        providerAlive: true,
      });
    }

    return { models, providerAlive: true };
  });
}

export function registerPricingRoutes(
  app: FastifyInstance,
  dataDir: string,
  getConfig: () => ConfigFile
) {
  // GET /api/pricing/status?provider=&model= — returns cached snapshot
  app.get("/api/pricing/status", async (request, reply) => {
    const { provider: providerName, model: modelName } = request.query as { provider?: string; model?: string };
    const config = getConfig();

    if (!providerName || !modelName) {
      const defaultProvider = config.defaultProvider ?? "";
      const defaultModel = config.defaultModel ?? "";
      const provider = config.providers.find((p) => p.displayName === defaultProvider);
      const model = provider?.models.find((m) => m.modelName === defaultModel);
      if (!provider || !model) {
        return reply.code(400).send({ error: "No provider/model specified and no default configured" });
      }
      return { provider: provider.displayName, model: model.modelName };
    }

    const provider = config.providers.find((p) => p.displayName === providerName);
    const model = provider?.models.find((m) => m.modelName === modelName);
    if (!provider || !model) {
      return reply.code(404).send({ error: "Provider or model not found" });
    }

    const snap = await getModelPricing(provider, model.modelName, config, dataDir);
    return snap;
  });

  // POST /api/pricing/refresh?provider=&model= — force refetch
  app.post("/api/pricing/refresh", async (request, reply) => {
    const { provider: providerName, model: modelName } = request.query as { provider?: string; model?: string };
    const config = getConfig();

    if (!providerName || !modelName) {
      return reply.code(400).send({ error: "provider and model query params required" });
    }

    const provider = config.providers.find((p) => p.displayName === providerName);
    const model = provider?.models.find((m) => m.modelName === modelName);
    if (!provider || !model) {
      return reply.code(404).send({ error: "Provider or model not found" });
    }

    const snap = await refreshModelPricing(provider, model.modelName, config, dataDir);
    return snap;
  });
}
