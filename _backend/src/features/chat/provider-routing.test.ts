import { afterAll, describe, expect, test } from "bun:test";
import { streamChat } from "./stream-llm";
import type { ProviderConfig } from "../../../../_shared/types";

// Local OpenAI-compatible SSE endpoint that records the request body so we can
// assert the SDK actually emits a top-level `provider` object on the wire.
let server: ReturnType<typeof Bun.serve> | null = null;
let seenBody: Record<string, unknown> | undefined;

function ensureServer() {
  if (server) return server;
  const encoder = new TextEncoder();
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (req.method === "POST" && new URL(req.url).pathname === "/v1/chat/completions") {
        seenBody = (await req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
        const stream = new ReadableStream({
          start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            send({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 1,
              model: "m",
              choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }],
            });
            send({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 1,
              model: "m",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
            send({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 1,
              model: "m",
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

afterAll(() => {
  server?.stop(true);
});

function providerFor(srv: ReturnType<typeof Bun.serve>): ProviderConfig {
  const port = srv.port;
  if (port == null) throw new Error("test server has no TCP port");
  return {
    displayName: "RoutingTest",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    models: [{ displayName: "m", modelName: "m" }],
  };
}

const messages = [
  { role: "system" as const, content: "sys", timestamp: new Date().toISOString() },
  { role: "user" as const, content: "hi", timestamp: new Date().toISOString() },
];

describe("provider routing", () => {
  test("providerRouting is injected into the outgoing request body", async () => {
    const srv = ensureServer();

    const result = await streamChat({
      provider: providerFor(srv),
      model: "m",
      messages,
      onToken: () => {},
      providerRouting: { order: ["deepinfra"], allowFallbacks: false },
    });

    expect(result.error).toBeUndefined();
    // Raw-capture layer saw the exact body the SDK sent.
    expect(result.rawRequest?.provider).toEqual({ order: ["deepinfra"], allow_fallbacks: false });
    // The server-side copy confirms it landed on the wire, not just in capture.
    expect(seenBody?.provider).toEqual({ order: ["deepinfra"], allow_fallbacks: false });
  });

  test("allowFallbacks defaults to true when omitted", async () => {
    const srv = ensureServer();

    const result = await streamChat({
      provider: providerFor(srv),
      model: "m",
      messages,
      onToken: () => {},
      providerRouting: { order: ["together"] },
    });

    expect(result.error).toBeUndefined();
    expect(seenBody?.provider).toEqual({ order: ["together"], allow_fallbacks: true });
  });

  test("no provider object when routing is absent", async () => {
    const srv = ensureServer();

    const result = await streamChat({
      provider: providerFor(srv),
      model: "m",
      messages,
      onToken: () => {},
    });

    expect(result.error).toBeUndefined();
    expect(seenBody?.provider).toBeUndefined();
  });
});
