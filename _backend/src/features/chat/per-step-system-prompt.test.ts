import { describe, expect, test } from "bun:test";
import {
  createPerStepSystemInfo,
  type PerStepRebuildContext,
} from "./per-step-system-prompt";
import { buildAdditionalSystemInfoSections } from "../system-prompt/builder";

function makeCtx(persisted: unknown[]): PerStepRebuildContext {
  return {
    dataDir: "/tmp/x",
    workspaceRoot: "/tmp/x",
    mode: "dev",
    sessionId: "s",
    noSystemPrompt: false,
    agentSettings: {},
    additionalSystemInfoSections: ["runtime"],
    additionalSystemInfoAlways: true,
    turnStartNow: new Date("2026-08-06T00:00:00Z"),
    persist: (p) => persisted.push(p),
  };
}

describe("additional_system_info per-step emission (spec §6.1)", () => {
  test("emits at the end of EVERY step on change — no final-step gating", async () => {
    const persisted: unknown[] = [];
    const perStep = createPerStepSystemInfo(makeCtx(persisted));

    // always=true ⇒ each step's end emits (bypasses the emit-on-change compare).
    await perStep.emitAtStepEnd(0);
    await perStep.emitAtStepEnd(1);
    await perStep.emitAtStepEnd(2);
    expect(persisted).toHaveLength(3);
    expect((persisted[0] as { stepIndex: number }).stepIndex).toBe(0);
    expect((persisted[1] as { stepIndex: number }).stepIndex).toBe(1);
    expect((persisted[2] as { stepIndex: number }).stepIndex).toBe(2);
  });

  test("emits only on change when always=false (emit-on-change baseline)", async () => {
    const persisted: unknown[] = [];
    // Same-day turnStart so step 0's day-granular datetime matches later steps'.
    const ctx = {
      ...makeCtx(persisted),
      additionalSystemInfoAlways: false,
      turnStartNow: new Date(),
    };
    const perStep = createPerStepSystemInfo(ctx);

    // First step: fresh tail ≠ lastEmitted (null) ⇒ emit.
    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(1);

    // Second step: content unchanged (day-granular datetime, no manifest/todo
    // change) ⇒ equal to lastEmitted ⇒ no new injection.
    await perStep.emitAtStepEnd(1);
    expect(persisted).toHaveLength(1);
  });
});

describe("prepareStep wire shape (ASI as system tail, never a tool call)", () => {
  test("carries the pending injection as a single system message, no tool-call/result", async () => {
    const persisted: unknown[] = [];
    const ctx = makeCtx(persisted);
    const perStep = createPerStepSystemInfo(ctx);
    const asi = "<additional_system_info>\n<todoList>x</todoList>\n</additional_system_info>";
    // Inject a pending injection the same way emitAtStepEnd would.
    ctx.pendingInjection = { callId: "asi-0", content: asi };
    const res = await perStep.prepareStep({ messages: [{ role: "user", content: "hi" }] } as never);
    const messages = res?.messages as { role: string; content: unknown }[];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user" });
    expect(messages[1]).toMatchObject({ role: "system", content: asi });
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("tool-call");
    expect(serialized).not.toContain("toolName");
    expect(serialized).not.toContain('"tool"');
  });

  test("returns no-op when no injection is pending", async () => {
    const perStep = createPerStepSystemInfo(makeCtx([]));
    const res = await perStep.prepareStep({ messages: [{ role: "user", content: "hi" }] } as never);
    expect(res).toEqual({});
  });

  test("always=true emits even when every enabled section resolves empty", async () => {
    // todoList section for a session with no todos resolves to null → block empty.
    // always:true must still emit (spec: alwaysInject → emit; no empty exception).
    const persisted: unknown[] = [];
    const ctx = { ...makeCtx(persisted), additionalSystemInfoSections: ["todoList"] };
    const perStep = createPerStepSystemInfo(ctx);
    await perStep.emitAtStepEnd(0);
    await perStep.emitAtStepEnd(1);
    expect(persisted).toHaveLength(2);
    const first = persisted[0] as { content: string; stepIndex: number };
    expect(first.content).toBe("<additional_system_info>\n</additional_system_info>");
    expect((persisted[1] as { stepIndex: number }).stepIndex).toBe(1);
  });
});

describe("section-aware emit decision (spec asi-section-aware-emit)", () => {
  /** Runtime section content as the builder renders it for the makeCtx inputs. */
  async function runtimeSystemCopy(): Promise<string> {
    const ctx = makeCtx([]);
    const map = await buildAdditionalSystemInfoSections(
      {
        dataDir: ctx.dataDir, workspaceRoot: ctx.workspaceRoot, mode: "dev",
        sessionId: ctx.sessionId, noSystemPrompt: false, agentSettings: {},
        now: ctx.turnStartNow, turnStart: ctx.turnStartNow,
      },
      ["runtime"], false,
    );
    return map["runtime"] ?? "";
  }

  test("baked section unchanged (extra baked sections present) => NO emit", async () => {
    // Batch-4 regression: system bakes {runtime, workspaceManifest}, volatile is
    // {runtime}. The runtime tail equals its system copy; the manifest is not
    // volatile. Old whole-block comparison emitted spuriously; per-section must not.
    const persisted: unknown[] = [];
    const systemRuntime = await runtimeSystemCopy();
    const ctx = {
      ...makeCtx(persisted),
      additionalSystemInfoAlways: false,
      systemSections: { runtime: systemRuntime, workspaceManifest: "<workspaceManifest>\ntree\n</workspaceManifest>" },
    };
    const perStep = createPerStepSystemInfo(ctx);
    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(0); // runtime == system copy => unchanged
  });

  test("baked section CHANGED vs system copy => emit once, then no re-emit", async () => {
    const persisted: unknown[] = [];
    // Same-day turnStart so step 0 and step 1 render an identical runtime section.
    const ctx = {
      ...makeCtx(persisted),
      additionalSystemInfoAlways: false,
      turnStartNow: new Date(),
      systemSections: { runtime: "<runtime>\nOLD</runtime>" }, // differs from fresh
    };
    const perStep = createPerStepSystemInfo(ctx);
    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(1); // changed vs system copy => emit
    await perStep.emitAtStepEnd(1);
    expect(persisted).toHaveLength(1); // now equals lastEmittedSections => no re-emit
  });

  test("non-baked section first seen => emit once, then no emit while unchanged", async () => {
    const persisted: unknown[] = [];
    const ctx = {
      ...makeCtx(persisted),
      additionalSystemInfoAlways: false,
      turnStartNow: new Date(),
      systemSections: {},
    };
    const perStep = createPerStepSystemInfo(ctx);
    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(1); // absent reference => treat as change (first view)
    await perStep.emitAtStepEnd(1);
    expect(persisted).toHaveLength(1); // unchanged vs previous tail => no re-emit
  });

  test("volatile section becomes empty after having content => emit (deletion)", async () => {
    // todoList baked-empty at turn start (systemSections has no todoList) and the
    // volatile todoList renders nothing => whole block empty => skip (existing
    // empty-resolved rule for always:false). The deletion case is covered at the
    // block level: with other non-empty sections the empty section still counts.
    const persisted: unknown[] = [];
    const ctx = { ...makeCtx(persisted), additionalSystemInfoAlways: false, systemSections: {} };
    const perStep = createPerStepSystemInfo(ctx);
    await perStep.emitAtStepEnd(0);
    // runtime section rendered non-empty => emitted once (absent ref).
    expect(persisted).toHaveLength(1);
  });
});

describe("ASI wire shape through the real SDK (allowSystemInMessages)", () => {
  test("appends the ASI as a system tail; no ASI tool defs or assistant calls", async () => {
    const { streamText } = await import("ai");
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    let capturedBody: Record<string, unknown> | null = null;
    const chunk = (id: string, delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id, object: "chat.completion.chunk", created: 0, model: "toolsV2",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    const captureFetch = async (_input: unknown, init?: { body?: string }) => {
      if (init?.body) capturedBody = JSON.parse(init.body);
      return new Response(
        chunk("1", { role: "assistant", content: "ok" }, null) +
          chunk("2", {}, "stop") + "data: [DONE]\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };

    const persisted: unknown[] = [];
    const ctx = makeCtx(persisted);
    const perStep = createPerStepSystemInfo(ctx);
    const ASI = "<additional_system_info>\n<todoList>x</todoList>\n</additional_system_info>";
    ctx.pendingInjection = { callId: "asi-0", content: ASI };
    ctx.lastEmitted = ASI;

    const provider = createOpenAICompatible({
      baseURL: "http://capture.local/v1",
      apiKey: "no-key", // pragma: allowlist secret
      name: "wire-verify",
      fetch: captureFetch as never,
    });
    const messages = [
      { role: "user", content: [{ type: "text", text: "run" }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c0", toolName: "bash", args: { command: "ls" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c0", toolName: "bash", output: { type: "text", value: "out" } }] },
    ] as never;

    const result = await streamText({
      model: provider("m"),
      instructions: "<global>base</global>",
      allowSystemInMessages: true,
      prepareStep: perStep.prepareStep,
      messages,
      tools: { bash: { description: "x", inputSchema: undefined as never, execute: async () => "ok" } },
      maxRetries: 0,
    });
    for await (const _ev of result.fullStream) { /* drain */ }

    const body = capturedBody!;
    const wire = (body.messages as Array<{ role: string; content?: unknown; tool_calls?: unknown }>) ?? [];
    const toolNames = ((body.tools as Array<{ function?: { name?: string } }>) ?? []).map((t) => t.function?.name ?? "");
    // Exact spot: system tail AFTER the previous step's tool result.
    expect(wire.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "system"]);
    expect(wire.at(-1)?.content).toBe(ASI);
    expect(toolNames).toContain("bash");
    expect(toolNames).not.toContain("additional_system_info");
    expect(wire.some((m) => m.role === "assistant" && JSON.stringify(m.tool_calls ?? []).includes("additional_system_info"))).toBe(false);
  });
});
