import { describe, test, expect, mock } from "bun:test";
import {
  shouldAutoContinueOnTool,
  shouldAutoContinueOnThinking,
  runAutoContinue,
  canAutoContinue,
  recordAutoContinue,
} from "./auto-continue";
import type { TurnResult } from "./run-turn";

function mkResult(opts: {
  success?: boolean;
  parts?: Array<{ type: string; [k: string]: unknown }>;
  content?: string;
}): TurnResult {
  return {
    sessionId: "s1",
    created: false,
    meta: { id: "s1", title: "", providerName: "", modelName: "", created: "", updated: "" },
    workspaceRoot: "/tmp",
    userMessage: { role: "user", content: "x", timestamp: "" },
    assistantMessage: {
      role: "assistant",
      content: opts.content ?? "",
      parts: opts.parts as any,
      timestamp: "",
      turnId: 1,
    },
    modelName: "m",
    providerName: "p",
    durationMs: 1,
    turnId: 1,
    success: opts.success ?? true,
  };
}

describe("shouldAutoContinueOnTool", () => {
  test("true when last part is a tool with no text after", () => {
    expect(
      shouldAutoContinueOnTool(
        mkResult({ parts: [{ type: "text" }, { type: "tool" }] })
      )
    ).toBe(true);
  });

  test("false when there is text after the last tool", () => {
    expect(
      shouldAutoContinueOnTool(
        mkResult({ parts: [{ type: "tool" }, { type: "text" }] })
      )
    ).toBe(false);
  });

  test("false when last part is text", () => {
    expect(shouldAutoContinueOnTool(mkResult({ parts: [{ type: "text" }] }))).toBe(false);
  });

  test("false when not success", () => {
    expect(
      shouldAutoContinueOnTool(mkResult({ success: false, parts: [{ type: "tool" }] }))
    ).toBe(false);
  });

  test("false when no parts", () => {
    expect(shouldAutoContinueOnTool(mkResult({ parts: [] }))).toBe(false);
  });
});

describe("shouldAutoContinueOnThinking", () => {
  test("true when last part is reasoning", () => {
    expect(
      shouldAutoContinueOnThinking(mkResult({ parts: [{ type: "reasoning" }] }))
    ).toBe(true);
  });

  test("false when last part is text", () => {
    expect(shouldAutoContinueOnThinking(mkResult({ parts: [{ type: "text" }] }))).toBe(false);
  });

  test("false when last part is tool (ended on tool, not thinking)", () => {
    expect(shouldAutoContinueOnThinking(mkResult({ parts: [{ type: "tool" }] }))).toBe(false);
  });
});

describe("runAutoContinue", () => {
  test("stops immediately when isCancelled returns true", async () => {
    const runTurn = mock((): Promise<TurnResult | null> =>
      Promise.resolve(mkResult({ parts: [{ type: "tool" }] }))
    );
    const res = await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "tool" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 5,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
      isCancelled: () => true,
    });
    expect(runTurn).toHaveBeenCalledTimes(0);
    expect(res.assistantMessage?.parts?.[0].type).toBe("tool");
  });

  test("stops mid-loop when isCancelled flips to true", async () => {
    let callCount = 0;
    let cancelled = false;
    const runTurn = mock((): Promise<TurnResult | null> => {
      callCount++;
      // Simulate user pressing stop after the first continuation turn
      if (callCount === 1) cancelled = true;
      return Promise.resolve(mkResult({ parts: [{ type: "tool" }] }));
    });
    const res = await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "tool" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 10,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
      isCancelled: () => cancelled,
    });
    // Only the first continuation runs, then the loop checks isCancelled and breaks
    expect(callCount).toBe(1);
    expect(res.assistantMessage?.parts?.[0].type).toBe("tool");
  });

  test("runs without isCancelled (backwards compatible)", async () => {
    const runTurn = mock((): Promise<TurnResult | null> =>
      Promise.resolve(mkResult({ parts: [{ type: "text", content: "done" }] }))
    );
    await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "tool" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 5,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  test("continues until model produces text", async () => {
    const calls: string[] = [];
    const runTurn = mock((content: string): Promise<TurnResult | null> => {
      calls.push(content);
      // first continuation ends on tool, second produces text
      const onTool = calls.length === 1;
      return Promise.resolve(
        mkResult({ parts: onTool ? [{ type: "tool" }] : [{ type: "text", content: "done" }] })
      );
    });

    const res = await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "tool" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 5,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
    });

    expect(calls).toEqual(["continue", "continue"]);
    expect(res.assistantMessage?.parts?.[0].type).toBe("text");
  });

  test("stops when max attempts reached", async () => {
    const runTurn = mock((): Promise<TurnResult | null> =>
      Promise.resolve(mkResult({ parts: [{ type: "tool" }] }))
    );
    const res = await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "tool" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 3,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
    });
    // initial + 3 attempts = 4 runTurn calls total (1 initial already counted, 3 continuations)
    expect(runTurn).toHaveBeenCalledTimes(3);
    expect(res.assistantMessage?.parts?.[0].type).toBe("tool");
  });

  test("stops immediately if initial does not need continue", async () => {
    const runTurn = mock((): Promise<TurnResult | null> =>
      Promise.resolve(mkResult({ parts: [{ type: "text" }] }))
    );
    await runAutoContinue({
      sessionId: "s1",
      initialResult: mkResult({ parts: [{ type: "text" }] }),
      attempts: new Map(),
      shouldContinue: shouldAutoContinueOnTool,
      maxAttempts: 5,
      windowValue: 1,
      windowUnit: "minutes",
      prompt: "continue",
      runTurn,
    });
    expect(runTurn).toHaveBeenCalledTimes(0);
  });
});

describe("canAutoContinue / recordAutoContinue", () => {
  test("respects max attempts within window", () => {
    const m = new Map<string, number[]>();
    const key = "s1";
    expect(canAutoContinue(m, key, 2, 1, "minutes")).toBe(true);
    recordAutoContinue(m, key);
    expect(canAutoContinue(m, key, 2, 1, "minutes")).toBe(true);
    recordAutoContinue(m, key);
    expect(canAutoContinue(m, key, 2, 1, "minutes")).toBe(false);
  });
});
