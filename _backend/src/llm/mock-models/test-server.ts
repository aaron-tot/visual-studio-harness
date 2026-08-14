// Local OpenAI-compatible SSE server that replays the toolsV2 action script,
// so the Test provider can run through the REAL AI SDK (streamText) against an
// endpoint — exercising prepareStep, the additional_system_info injection, and
// the true wire under the regression gate. Reuses the mock action list; tool
// EXECUTION is handled by the SDK via the shim toolset (buildMockTools), which
// calls shared.ts's executeTool so results match the expected text.

import { z } from "zod";
import type { ToolSet } from "ai";
import { actions as toolsV2Actions } from "./toolsV2";
import { executeTool, type MockAction, type TextAction, type ToolAction } from "./shared";

let server: ReturnType<typeof Bun.serve> | null = null;
let port = 0;

/** Server-side scripts: model name → action list. Only models listed here go
 *  through the endpoint; other test models keep the in-process generator. */
const MODEL_ACTIONS: Record<string, MockAction[]> = {
  toolsV2: toolsV2Actions as MockAction[],
};

export function getMockActions(model: string): MockAction[] | undefined {
  return MODEL_ACTIONS[model];
}

export function hasMockActions(model: string): boolean {
  return MODEL_ACTIONS[model] != null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the local test server (lazy singleton) and return its base URL.
 */
export function ensureTestServer(): string {
  if (server) return `http://127.0.0.1:${port}/v1`;
  server = Bun.serve({ port: 0, fetch: handle });
  port = server.port ?? 0;
  console.log(`[mock-model] test server listening on :${port}`);
  return `http://127.0.0.1:${port}/v1`;
}

/** Count prior REAL scripted tool-calls in the request history (skips ASI + any non-action tool). */
function countRealToolCalls(messages: unknown[], toolNames: Set<string>): number {
  let n = 0;
  for (const m of messages) {
    const msg = m as { role?: string; tool_calls?: unknown[]; content?: unknown };
    if (msg.role !== "assistant") continue;
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = (tc as { function?: { name?: string } })?.function?.name;
      if (fn && toolNames.has(fn)) n++;
    }
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        const part = c as { type?: string; tool_calls?: unknown[] };
        if (part.type === "tool_calls") {
          for (const tc of part.tool_calls ?? []) {
            const fn = (tc as { function?: { name?: string } })?.function?.name;
            if (fn && toolNames.has(fn)) n++;
          }
        }
      }
    }
  }
  return n;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body: { messages?: unknown[]; model?: string };
    try {
      body = (await req.json()) as { messages?: unknown[]; model?: string };
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const model = body.model ?? "";
    const actions = MODEL_ACTIONS[model];
    if (!actions) {
      return new Response(JSON.stringify({ error: { message: `no script for model ${model}` } }), { status: 404 });
    }
    const toolNames = new Set(actions.filter((a) => a.type === "tool").map((a) => (a as ToolAction).toolName));
    const messages = body.messages ?? [];
    const speed = Number(req.headers.get("x-test-speed") ?? "0") || 0;
    const n = countRealToolCalls(messages, toolNames);
    const textAction = actions[2 * n];
    const toolAction = actions[2 * n + 1];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          if (textAction?.type === "text") {
            const t = textAction as TextAction;
            for (let i = 1; i <= t.count; i++) {
              const token = i === 1 ? `${t.prefix}${i}` : ` ${t.prefix}${i}`;
              send({ choices: [{ index: 0, delta: { role: "assistant", content: token }, finish_reason: null }] });
              if (speed > 0) await sleep(speed);
            }
          }

          let hasTool = false;
          if (toolAction?.type === "tool") {
            hasTool = true;
            const tc = toolAction as ToolAction;
            send({
              choices: [{
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [{
                    index: 0,
                    id: `call_${n}`,
                    type: "function",
                    function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
                  }],
                },
                finish_reason: null,
              }],
            });
            if (speed > 0) await sleep(speed * 5);
          }

          send({
            choices: [{ index: 0, delta: {}, finish_reason: hasTool ? "tool_calls" : "stop" }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 20,
              total_tokens: 70,
              prompt_tokens_details: { cached_tokens: 10 },
            },
          });
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }
  return new Response("not found", { status: 404 });
}

/**
 * Build a shim toolset for the Test provider: each scripted tool simply calls
 * shared.ts's executeTool (matching the expected text), so the real SDK can
 * execute the tools without the harness tool output diverging.
 */
export function buildMockTools(model: string, workspaceRoot?: string): ToolSet {
  const actions = MODEL_ACTIONS[model];
  const tools: ToolSet = {};
  for (const name of new Set(actions?.filter((a) => a.type === "tool").map((a) => (a as ToolAction).toolName) ?? [])) {
    tools[name] = {
      inputSchema: z.record(z.unknown()),
      execute: async (args) => {
        const r = executeTool(name, (args ?? {}) as Record<string, unknown>, workspaceRoot);
        return r == null ? "" : r;
      },
    };
  }
  return tools;
}
