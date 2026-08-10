import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { ConfigFile } from "../../../_shared/types";
import { registerConfigRoutes } from "./config";
import { resolveRuntimeFromSettings } from "../features/agents/runtime-settings";
import { streamChat } from "../features/chat/stream-llm";

/** Exactly what the ModelRoutingEditor save produces for an OpenRouter model. */
const ROUTED_CONFIG: ConfigFile = {
  providers: [
    {
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test-123", // pragma: allowlist secret
      models: [
        {
          displayName: "deepseek/deepseek-chat",
          modelName: "deepseek/deepseek-chat",
          providerOrder: ["deepinfra", "together"],
          allowProviderFallbacks: false,
        },
      ],
    },
  ],
};

describe("provider routing config chain (UI save → disk → runtime → wire)", () => {
  let testDir: string;
  let dataDir: string;
  let app: ReturnType<typeof Fastify>;
  let currentConfig: ConfigFile;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-provider-routing-"));
    dataDir = join(testDir, "data");
    await mkdir(dataDir, { recursive: true });
    currentConfig = { providers: [] };
    app = Fastify({ logger: false });
    registerConfigRoutes(app, dataDir, () => currentConfig, (c) => { currentConfig = c; });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it("PUT /api/config persists routing fields to disk and reloads them", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/config", payload: ROUTED_CONFIG });
    expect(put.statusCode).toBe(200);

    const onDisk = JSON.parse(await readFile(join(dataDir, "config.json"), "utf-8")) as ConfigFile;
    const diskModel = onDisk.providers[0].models[0];
    expect(diskModel.providerOrder).toEqual(["deepinfra", "together"]);
    expect(diskModel.allowProviderFallbacks).toBe(false);

    const get = await app.inject({ method: "GET", url: "/api/config" });
    expect(get.statusCode).toBe(200);
    const reloaded = get.json() as ConfigFile;
    const reloadedModel = reloaded.providers[0].models[0];
    expect(reloadedModel.providerOrder).toEqual(["deepinfra", "together"]);
    expect(reloadedModel.allowProviderFallbacks).toBe(false);
  });

  it("resolved runtime model carries routing into the streamChat request body", async () => {
    await app.inject({ method: "PUT", url: "/api/config", payload: ROUTED_CONFIG });

    // Mirrors run-turn: resolve the model from config, then pass routing through.
    const runtime = resolveRuntimeFromSettings(
      { providerName: "OpenRouter", modelName: "deepseek/deepseek-chat" },
      currentConfig.providers,
    );
    expect(runtime.model.providerOrder).toEqual(["deepinfra", "together"]);
    expect(runtime.model.allowProviderFallbacks).toBe(false);

    // Local OpenAI-compatible SSE endpoint that captures the outgoing request body.
    let seenBody: Record<string, unknown> | undefined;
    const encoder = new TextEncoder();
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (req.method === "POST" && new URL(req.url).pathname === "/v1/chat/completions") {
          seenBody = (await req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
          const stream = new ReadableStream({
            start(controller) {
              const send = (obj: unknown) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              send({
                id: "c",
                object: "chat.completion.chunk",
                created: 1,
                model: "m",
                choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }],
              });
              send({
                id: "c",
                object: "chat.completion.chunk",
                created: 1,
                model: "m",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const port = srv.port;
    if (port == null) throw new Error("test server has no TCP port");
    try {
      const provider = { ...currentConfig.providers[0], baseUrl: `http://127.0.0.1:${port}/v1` };
      const result = await streamChat({
        provider,
        model: runtime.model.modelName,
        messages: [
          { role: "system", content: "sys", timestamp: new Date().toISOString() },
          { role: "user", content: "hi", timestamp: new Date().toISOString() },
        ],
        onToken: () => {},
        providerRouting: runtime.model.providerOrder
          ? { order: runtime.model.providerOrder, allowFallbacks: runtime.model.allowProviderFallbacks ?? true }
          : undefined,
      });
      expect(result.error).toBeUndefined();
      expect(seenBody?.provider).toEqual({ order: ["deepinfra", "together"], allow_fallbacks: false });
    } finally {
      srv.stop(true);
    }
  });
});
