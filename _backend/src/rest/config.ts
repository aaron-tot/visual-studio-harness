import type { FastifyInstance } from "fastify";
import type { ConfigFile } from "../../../_shared/types";
import { loadConfig, saveConfig } from "../storage/config";
import { broadcastConfig } from "../ws/configPush";
import { serverOriginFromBaseUrl } from "../llm/slots";

export function registerConfigRoutes(
  app: FastifyInstance,
  dataDir: string,
  getConfig: () => ConfigFile,
  setConfig: (config: ConfigFile) => void
) {
  // Always re-read from disk so external edits work even if fs.watch fails (EMFILE, etc.)
  app.get("/api/config", async () => {
    try {
      const fromDisk = await loadConfig(dataDir);
      setConfig(fromDisk);
      return fromDisk;
    } catch {
      return getConfig();
    }
  });

  app.put("/api/config", async (request, reply) => {
    const config = request.body as ConfigFile;
    await saveConfig(dataDir, config);
    setConfig(config);
    broadcastConfig(config);
    return { ok: true };
  });

  app.get("/api/providers/:index/models", async (request, reply) => {
    const { index } = request.params as { index: string };
    // Prefer fresh disk config (after Save & Connect) over in-memory snapshot
    let provider = getConfig().providers[parseInt(index, 10)];
    try {
      const fromDisk = await loadConfig(dataDir);
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
        return {
          displayName: id,
          modelName: id,
          enabled: true,
          isLoaded,
        };
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
