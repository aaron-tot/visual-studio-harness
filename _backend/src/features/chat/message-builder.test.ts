import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { summaryRanges } from "../../db/schema";
import {
  getNextTurnNumber,
  createTurn,
  createStep,
  insertStepPart,
  finalizeTurnTrace,
} from "./db-trace";
import { createSession } from "../sessions/db";
import { buildModelMessages, type BuildModelMessagesOptions } from "./message-builder";

const SESSION_ID = "test-message-builder-session";
let dataDir: string;

function options(overrides: Partial<BuildModelMessagesOptions> = {}): BuildModelMessagesOptions {
  return {
    contextTurnIds: [],
    includeIncompleteTurns: true,
    includeTextParts: true,
    includeTools: true,
    includeReasoningParts: false,
    includePatchParts: false,
    includeOtherParts: false,
    currentTurnNumber: 1,
    currentUserMessage: "current",
    ...overrides,
  };
}

async function makeTurn(
  turnNumber: number,
  parts: { type: string; data: Record<string, unknown>; status?: string; toolCallId?: string; toolName?: string }[],
  finalize: boolean,
): Promise<number> {
  const turnId = createTurn(SESSION_ID, turnNumber, `user ${turnNumber}`, new Date().toISOString(), {}, dataDir);
  const stepId = createStep(turnId, SESSION_ID, 0, {}, dataDir);
  parts.forEach((p, i) => {
    insertStepPart(
      SESSION_ID,
      turnId,
      stepId,
      p.type,
      p.data,
      i + 1,
      p.status ?? "completed",
      p.toolCallId ? { toolCallId: p.toolCallId, toolName: p.toolName ?? "read" } : {},
      dataDir,
    );
  });
  if (finalize) {
    finalizeTurnTrace(turnId, { success: true, finishReason: "stop" }, dataDir);
  }
  return turnId;
}

/** Multi-step turn: each inner array is one step's parts (stepIndex = array index). */
async function makeMultiStepTurn(
  turnNumber: number,
  stepsParts: { type: string; data: Record<string, unknown>; status?: string; toolCallId?: string; toolName?: string }[][],
  finalize: boolean,
): Promise<number> {
  const turnId = createTurn(SESSION_ID, turnNumber, `user ${turnNumber}`, new Date().toISOString(), {}, dataDir);
  let seq = 0;
  for (let stepIndex = 0; stepIndex < stepsParts.length; stepIndex++) {
    const stepId = createStep(turnId, SESSION_ID, stepIndex, {}, dataDir);
    for (const p of stepsParts[stepIndex]!) {
      seq += 1;
      insertStepPart(
        SESSION_ID,
        turnId,
        stepId,
        p.type,
        p.data,
        seq,
        p.status ?? "completed",
        p.toolCallId ? { toolCallId: p.toolCallId, toolName: p.toolName ?? "read" } : {},
        dataDir,
      );
    }
  }
  if (finalize) {
    finalizeTurnTrace(turnId, { success: true, finishReason: "stop" }, dataDir);
  }
  return turnId;
}

function roleSequence(messages: { role: string }[]): string[] {
  return messages.map((m) => m.role);
}

function assistantToolNames(m: { role: string; content?: unknown }): string[] {
  if (m.role !== "assistant" || !Array.isArray(m.content)) return [];
  return (m.content as { type?: string; toolName?: string }[])
    .filter((p) => p.type === "tool-call")
    .map((p) => p.toolName ?? "");
}

function assistantHasReasoning(m: { role: string; content?: unknown }): boolean {
  if (m.role !== "assistant" || !Array.isArray(m.content)) return false;
  return (m.content as { type?: string }[]).some((p) => p.type === "reasoning");
}

beforeAll(async () => {
  const base = join(tmpdir(), `vsh-mb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions", SESSION_ID), { recursive: true });
  getDbForDataDir(dataDir);
  createSession(
    { id: SESSION_ID, title: "mb test", providerName: "test", modelName: "test", created: new Date().toISOString(), updated: new Date().toISOString() },
    dataDir,
  );
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

describe("buildModelMessages tool parts", () => {
  test("completed tool part emits paired tool-call and tool-result", async () => {
    const tId = await makeTurn(
      1,
      [{ type: "tool", data: { toolCallId: "call_a", args: { path: "x" }, result: "ok" }, status: "completed", toolCallId: "call_a", toolName: "read" }],
      true,
    );
    const { messages } = await buildModelMessages(SESSION_ID, "sys", options({ contextTurnIds: [tId], currentTurnNumber: 2 }), dataDir);

    const assistant = messages.find((m) => m.role === "assistant");
    const tool = messages.find((m) => m.role === "tool");

    expect(assistant?.content).toContainEqual(
      expect.objectContaining({ type: "tool-call", toolCallId: "call_a", toolName: "read", input: { path: "x" } }),
    );
    expect(tool?.content).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call_a",
        output: { type: "text", value: "ok" },
      }),
    );
  });

  test("running/aborted tool part emits tool-call paired with error-text result", async () => {
    const tId = await makeTurn(
      2,
      [{ type: "tool", data: { toolCallId: "call_orphan", args: { cmd: "ls" } }, status: "running", toolCallId: "call_orphan", toolName: "bash" }],
      false,
    );
    const { messages } = await buildModelMessages(SESSION_ID, "sys", options({ contextTurnIds: [tId], currentTurnNumber: 3 }), dataDir);

    const assistant = messages.find((m) => m.role === "assistant");
    const tool = messages.find((m) => m.role === "tool");

    // Tool-call must still be present...
    expect(assistant?.content).toContainEqual(
      expect.objectContaining({ type: "tool-call", toolCallId: "call_orphan", toolName: "bash" }),
    );
    // ...but paired with a matching error-text result so the SDK doesn't throw
    expect(tool?.content).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call_orphan",
        output: expect.objectContaining({ type: "error-text" }),
      }),
    );
  });

  test("includeTools=false emits neither tool-call nor tool-result", async () => {
    const tId = await makeTurn(
      3,
      [{ type: "tool", data: { toolCallId: "call_hidden", args: {} }, status: "completed", toolCallId: "call_hidden", toolName: "read" }],
      true,
    );
    const { messages } = await buildModelMessages(SESSION_ID, "sys", options({ contextTurnIds: [tId], includeTools: false, currentTurnNumber: 4 }), dataDir);

    const assistant = messages.find((m) => m.role === "assistant");
    const tool = messages.find((m) => m.role === "tool");

    expect(assistant).toBeUndefined();
    expect(tool).toBeUndefined();
  });

  test("summaries do not control normal-message context (all turns included)", async () => {
    // A summary range exists, but it must NOT be prepended into live turn
    // context, nor cause covered turns to be skipped. Summaries are a separate
    // display layer; regular turn context follows the circle only.
    const summaryTurnId = createTurn(SESSION_ID, 200, "Summarize conversation turns 10–12", new Date().toISOString(), {}, dataDir);
    const summaryStepId = createStep(summaryTurnId, SESSION_ID, 0, {}, dataDir);
    insertStepPart(SESSION_ID, summaryTurnId, summaryStepId, "text", { content: "SUMMARY_TEXT" }, 1, "completed", {}, dataDir);

    const db = getDbForDataDir(dataDir);
    db.insert(summaryRanges).values({
      sessionId: SESSION_ID,
      summaryTurnId,
      startTurn: 10,
      endTurn: 12,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 10,
      createdAt: new Date().toISOString(),
    }).run();

    const t10 = await makeTurn(10, [{ type: "text", data: { content: "ten" } }], true);
    const t12 = await makeTurn(12, [{ type: "text", data: { content: "twelve" } }], true);
    const t13 = await makeTurn(13, [{ type: "text", data: { content: "thirteen" } }], true);

    const { messages } = await buildModelMessages(SESSION_ID, "sys", options({
      contextTurnIds: [t10, t12, t13],
      currentTurnNumber: 14,
      currentUserMessage: "current",
    }), dataDir);

    const textMessages = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) =>
      Array.isArray(m.content) ? (m.content as any[]).map((p) => p.text).join("") : (m.content as string),
    );

    // Summary is NOT injected, and covered turns are NOT skipped.
    expect(textMessages.some((t) => t.includes("SUMMARY_TEXT"))).toBe(false);
    expect(textMessages).toContain("ten");
    expect(textMessages).toContain("twelve");
    expect(textMessages).toContain("thirteen");
    expect(textMessages).toContain("current");

    // Cleanup
    db.delete(summaryRanges).where(eq(summaryRanges.sessionId, SESSION_ID)).run();
  });
});

describe("buildModelMessages custom part stripping", () => {
  test("error/retry parts never reach the model, even with includeOtherParts", async () => {
    const tId = await makeTurn(
      30,
      [
        { type: "text", data: { content: "ok text" } },
        { type: "error", data: { message: "conn reset", retries: [{ attempt: 1, status: "failed" }] } },
        { type: "retry", data: { attempt: 1 } },
      ],
      true,
    );
    const { messages } = await buildModelMessages(
      SESSION_ID,
      "sys",
      options({ contextTurnIds: [tId], includeOtherParts: true, currentTurnNumber: 31, currentUserMessage: "current" }),
      dataDir,
    );

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.content).not.toContainEqual(expect.objectContaining({ type: "error" } as any));
    expect(assistant?.content).not.toContainEqual(expect.objectContaining({ type: "retry" } as any));
    expect(JSON.stringify(assistant?.content)).not.toContain("conn reset");
    expect(JSON.stringify(assistant?.content)).toContain("ok text");
  });
});

describe("buildModelMessages additional_system_info replay", () => {
  const stored = "<additional_system_info>\n<runtime>1.2.3</runtime>\n</additional_system_info>";

  test("replays a stored injection verbatim as a system-role tail message", async () => {
    const tId = await makeTurn(
      20,
      [
        {
          type: "tool",
          data: { content: stored, kind: "system-info", additionalSystemInfo: true },
          toolCallId: "asi-1",
          toolName: "additional_system_info",
        },
        { type: "text", data: { content: "assistant twenty" } },
      ],
      true,
    );
    const { messages } = await buildModelMessages(
      SESSION_ID,
      "sys",
      options({ contextTurnIds: [tId], currentTurnNumber: 21, currentUserMessage: "current" }),
      dataDir,
    );
    // No fabricated assistant tool-call and no tool-result for the injection.
    const asis = messages.filter((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("additional_system_info"));
    expect(asis).toHaveLength(1);
    expect(asis[0]!.content).toBe(stored);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(assistant?.content ?? [])).not.toContain("additional_system_info");
    const tool = messages.find((m) => m.role === "tool");
    expect(JSON.stringify(tool?.content ?? [])).not.toContain("additional_system_info");
  });

  test("replays verbatim and never re-renders (byte-stable across calls)", async () => {
    const tId = await makeTurn(
      21,
      [
        {
          type: "tool",
          data: { content: stored, kind: "system-info", additionalSystemInfo: true },
          toolCallId: "asi-2",
          toolName: "additional_system_info",
        },
      ],
      true,
    );
    const base = options({ contextTurnIds: [tId], currentTurnNumber: 22, currentUserMessage: "next" });
    const a = await buildModelMessages(SESSION_ID, "sys", base, dataDir);
    const b = await buildModelMessages(SESSION_ID, "sys", base, dataDir);
    expect(b.messages).toEqual(a.messages);
  });
});

describe("additionalSystemInfo replay byte-stability (R3 acceptance)", () => {
  test("consecutive reassemblies replay stored additional_system_info byte-identically", async () => {
    const stored = "<additional_system_info>\n<runtime>turn-5</runtime>\n</additional_system_info>";
    const t5 = await makeTurn(
      5,
      [
        { type: "tool", data: { content: stored, kind: "system-info", additionalSystemInfo: true },
          toolCallId: "asi-5", toolName: "additional_system_info" },
        { type: "text", data: { content: "five" } },
      ],
      true,
    );
    const base = options({ contextTurnIds: [t5], currentTurnNumber: 6, currentUserMessage: "next" });
    const first = await buildModelMessages(SESSION_ID, "sys", base, dataDir);
    const second = await buildModelMessages(SESSION_ID, "sys", base, dataDir);
    expect(second.messages).toEqual(first.messages); // whole array byte-identical
    const sys = first.messages.find((m) => m.role === "system" && m.content === stored);
    expect(sys).toBeDefined(); // verbatim string replayed as a system tail, never re-rendered
  });
});

describe("buildModelMessages step-faithful multi-step history (thinking mode)", () => {
  const asi0 = "<additional_system_info>\n<runtime>s0</runtime>\n</additional_system_info>";
  const asi1 = "<additional_system_info>\n<runtime>s1</runtime>\n</additional_system_info>";

  test("does not collapse multi-step tools into one assistant message", async () => {
    // Live shape on replay:
    //   user → assistant(R0 + bash0) → tool → system(ASI0)
    //        → assistant(R1 + read1) → tool → system(ASI1)
    //        → assistant(text)
    const tId = await makeMultiStepTurn(
      40,
      [
        [
          { type: "reasoning", data: { content: "think-step-0" } },
          { type: "tool", data: { toolCallId: "c0", args: { cmd: "ls" }, result: "out0" }, toolCallId: "c0", toolName: "bash" },
          {
            type: "tool",
            data: { content: asi0, kind: "system-info", additionalSystemInfo: true },
            toolCallId: "asi-40-0",
            toolName: "additional_system_info",
          },
        ],
        [
          { type: "reasoning", data: { content: "think-step-1" } },
          { type: "tool", data: { toolCallId: "c1", args: { path: "a" }, result: "out1" }, toolCallId: "c1", toolName: "read" },
          {
            type: "tool",
            data: { content: asi1, kind: "system-info", additionalSystemInfo: true },
            toolCallId: "asi-40-1",
            toolName: "additional_system_info",
          },
        ],
        [{ type: "text", data: { content: "final answer" } }],
      ],
      true,
    );

    const { messages } = await buildModelMessages(
      SESSION_ID,
      "sys",
      options({
        contextTurnIds: [tId],
        includeReasoningParts: true,
        currentTurnNumber: 41,
        currentUserMessage: "next",
      }),
      dataDir,
    );

    // Drop base system + trailing current user for the turn body.
    const body = messages.filter((m, i) => !(i === 0 && m.role === "system") && !(m.role === "user" && m.content === "next"));
    // user + (asst real, tool, system ASI) * 2 + asst text
    expect(roleSequence(body)).toEqual([
      "user",
      "assistant", // step0 real
      "tool",
      "system", // step0 ASI tail
      "assistant", // step1 real
      "tool",
      "system", // step1 ASI tail
      "assistant", // final text
    ]);

    const assistants = body.filter((m) => m.role === "assistant");
    expect(assistantToolNames(assistants[0]!)).toEqual(["bash"]);
    expect(assistantToolNames(assistants[1]!)).toEqual(["read"]);
    expect(assistantToolNames(assistants[2]!)).toEqual([]);

    // Per-step reasoning stays on the matching real-tool assistant (not one mega blob).
    const r0 = (assistants[0]!.content as { type: string; text?: string }[]).find((p) => p.type === "reasoning");
    const r1 = (assistants[1]!.content as { type: string; text?: string }[]).find((p) => p.type === "reasoning");
    expect(r0?.text).toBe("think-step-0");
    expect(r1?.text).toBe("think-step-1");

    // ASI content stays verbatim, as system-role tails (no tool-call/result pair).
    const asiSystems = body.filter((m) => m.role === "system");
    const asiValues = asiSystems
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((v) => v.includes("additional_system_info"));
    expect(asiValues).toContain(asi0);
    expect(asiValues).toContain(asi1);

    // Must NOT be a single assistant with all tool names collapsed.
    const mega = assistants.find((a) => assistantToolNames(a).length >= 3);
    expect(mega).toBeUndefined();
  });

  test("ASI after real tools on same step is a system tail, not an assistant pair", async () => {
    const stored = "<additional_system_info>\n<x>1</x>\n</additional_system_info>";
    const tId = await makeTurn(
      41,
      [
        { type: "reasoning", data: { content: "r" } },
        { type: "tool", data: { toolCallId: "t1", args: {}, result: "ok" }, toolCallId: "t1", toolName: "bash" },
        {
          type: "tool",
          data: { content: stored, kind: "system-info", additionalSystemInfo: true },
          toolCallId: "asi-41",
          toolName: "additional_system_info",
        },
      ],
      true,
    );
    const { messages } = await buildModelMessages(
      SESSION_ID,
      "sys",
      options({ contextTurnIds: [tId], includeReasoningParts: true, currentTurnNumber: 42 }),
      dataDir,
    );
    const body = messages.filter((m, i) => !(i === 0 && m.role === "system") && !(m.role === "user" && m.content === "current"));
    expect(roleSequence(body)).toEqual(["user", "assistant", "tool", "system"]);
    const assts = body.filter((m) => m.role === "assistant");
    expect(assistantToolNames(assts[0]!)).toEqual(["bash"]);
    const asiSys = body.find((m) => m.role === "system");
    expect(asiSys?.content).toBe(stored);
  });

  test("tool-call assistant without stored reasoning still gets a reasoning part", async () => {
    const tId = await makeTurn(
      42,
      [{ type: "tool", data: { toolCallId: "tx", args: {}, result: "y" }, toolCallId: "tx", toolName: "bash" }],
      true,
    );
    const { messages } = await buildModelMessages(
      SESSION_ID,
      "sys",
      options({ contextTurnIds: [tId], includeReasoningParts: false, currentTurnNumber: 43 }),
      dataDir,
    );
    const asst = messages.find((m) => m.role === "assistant");
    expect(assistantHasReasoning(asst!)).toBe(true);
    expect(assistantToolNames(asst!)).toEqual(["bash"]);
  });
});
