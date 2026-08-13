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

  test("replays a stored injection verbatim as assistant tool_call + tool result", async () => {
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
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContainEqual(
      expect.objectContaining({ type: "tool-call", toolName: "additional_system_info", toolCallId: "asi-1" }),
    );
    const tool = messages.find((m) => m.role === "tool");
    expect(tool?.content).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "asi-1",
        output: { type: "text", value: stored },
      }),
    );
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
    const tool = first.messages.find((m) => m.role === "tool");
    const output = (tool?.content as any[])?.[0]?.output;
    expect(output?.value).toBe(stored); // verbatim string replayed, never re-rendered
  });
});
