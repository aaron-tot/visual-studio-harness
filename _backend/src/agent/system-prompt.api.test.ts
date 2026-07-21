/**
 * API-level test: 5 user turns via POST /api/messages produce turns with
 * system messages stored in trace turns table (one per turn for audit).
 *
 * streamChat is mocked so no real LLM is required.
 */
import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { ConfigFile, Message } from "../../../_shared/types";

const capturedModelCalls: { systemCount: number; firstRole?: string }[] = [];

mock.module("../features/chat/stream-llm", () => ({
  streamChat: async (opts: { messages: Message[] }) => {
    const systems = opts.messages.filter((m) => m.role === "system");
    capturedModelCalls.push({
      systemCount: systems.length,
      firstRole: opts.messages[0]?.role,
    });
    // Simulate successful assistant text.
    return { content: `reply-${capturedModelCalls.length}`, parts: [] };
  },
}));

// Import routes AFTER mock so runTurn -> streamChat uses the mock.
const { registerMessageRoutes } = await import("../rest/messages");
const { registerSessionRoutes } = await import("../rest/sessions");
const { setHooksSystem, createHooksSystem } = await import("../features/hooks");
const { ensureGlobal } = await import("../features/tools/perms/store");
const { ensureGlobalAgentsFile } = await import("./system-prompt");

describe("API system prompt audit log", () => {
  let dataDir: string;
  let workspaceRoot: string;
  let app: ReturnType<typeof Fastify>;
  let prevTools: string | undefined;

  const config: ConfigFile = {
    providers: [
      {
        displayName: "Mock Provider",
        baseUrl: "http://127.0.0.1:9/v1",
        models: [
          {
            displayName: "mock-model",
            modelName: "mock-model",
            enabled: true,
          },
        ],
        enabled: true,
      },
    ],
    defaultProvider: "Mock Provider",
    defaultModel: "mock-model",
  };

  beforeAll(async () => {
    prevTools = process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED;
    process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED = "0";

    const base = join(
      tmpdir(),
      `vsh-sys-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    dataDir = join(base, "data");
    workspaceRoot = join(base, "workspace");
    await mkdir(dataDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );
    await ensureGlobal(dataDir);
    await ensureGlobalAgentsFile(dataDir, "dev");
    await writeFile(join(workspaceRoot, "agents.md"), "# project agents\n- use bun\n");

    setHooksSystem(createHooksSystem());
    app = Fastify({ logger: false });
    registerSessionRoutes(app, dataDir);
    registerMessageRoutes(app, dataDir, () => config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    setHooksSystem(null);
    if (prevTools === undefined) delete process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED;
    else process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED = prevTools;
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  test("5 user messages via POST /api/messages produce 5 turns with system messages", async () => {
    capturedModelCalls.length = 0;
    let sessionId: string | null = null;

    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/messages",
        payload: {
          content: `user message ${i}`,
          sessionId: sessionId ?? "new",
          workspaceRoot,
          providerName: "Mock Provider",
          modelName: "mock-model",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        sessionId: string;
        error?: string | null;
        assistantMessage?: { content?: string } | null;
      };
      expect(body.error).toBeNull();
      expect(body.sessionId).toBeTruthy();
      sessionId = body.sessionId;
    }

    // Session via API — messages should be user+assistant only (no system in flattened array)
    const getRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const session = getRes.json() as { messages: Message[] };
    const systems = session.messages.filter((m) => m.role === "system");
    const users = session.messages.filter((m) => m.role === "user");
    const assistants = session.messages.filter((m) => m.role === "assistant");

    expect(users).toHaveLength(5);

    // Check trace projectors for assistant messages
    const { projectSessionChat } = await import("../features/chat/project-chat");
    const projectedMessages = projectSessionChat(sessionId!, dataDir);
    const projectedAssistants = projectedMessages.filter((m) => m.role === "assistant");
    expect(projectedAssistants).toHaveLength(5);

    // Each turn in trace has user + assistant messages
    const turnIds = [...new Set(projectedMessages.filter((m) => m.turnId).map((m) => m.turnId))];
    expect(turnIds).toHaveLength(5);

    for (const tid of turnIds) {
      const turnUsers = projectedMessages.filter((m) => m.turnId === tid && m.role === "user");
      const turnAssistants = projectedMessages.filter((m) => m.turnId === tid && m.role === "assistant");
      expect(turnUsers).toHaveLength(1);
      expect(turnAssistants).toHaveLength(1);
    }

    // Latest system prompt stored in DB
    const { getSessionSystemPrompt } = await import("../features/sessions/db");
    const systemPrompt = getSessionSystemPrompt(sessionId!, dataDir);
    expect(systemPrompt).toContain("## Runtime");

    // Each LLM call saw exactly one system (enforced before SDK)
    expect(capturedModelCalls).toHaveLength(5);
    for (const c of capturedModelCalls) {
      expect(c.systemCount).toBe(1);
      expect(c.firstRole).toBe("system");
    }
  });
});
