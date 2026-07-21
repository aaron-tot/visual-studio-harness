import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConfigFile, Message, MessagePartType } from "../../../../_shared/types";
import { isStopTurnResult, type ToolResult } from "./types";
import { toolResultForSdk } from "./registry";

// ---------------------------------------------------------------------------
// Unit: isStopTurnResult
// ---------------------------------------------------------------------------
describe("isStopTurnResult", () => {
  test("returns true when _stopTurn is set", () => {
    expect(isStopTurnResult({ _stopTurn: true })).toBe(true);
    expect(isStopTurnResult({ output: "x", _stopTurn: true })).toBe(true);
  });

  test("returns false for plain strings", () => {
    expect(isStopTurnResult("hello")).toBe(false);
    expect(isStopTurnResult("")).toBe(false);
  });

  test("returns false when _stopTurn is missing or false", () => {
    expect(isStopTurnResult({ output: "x" })).toBe(false);
    expect(isStopTurnResult({ _stopTurn: false })).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isStopTurnResult(null)).toBe(false);
    expect(isStopTurnResult(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: toolResultForSdk
// ---------------------------------------------------------------------------
describe("toolResultForSdk", () => {
  test("returns full object when _stopTurn is set", () => {
    const result: ToolResult = {
      title: "stop",
      output: "turn ended",
      _stopTurn: true,
    };
    const rv = toolResultForSdk(result);
    expect(rv).toBe(result);
    expect((rv as ToolResult)._stopTurn).toBe(true);
  });

  test("returns string output when no _stopTurn", () => {
    const result: ToolResult = {
      title: "ok",
      output: "hello",
    };
    expect(toolResultForSdk(result)).toBe("hello");
  });

  test("returns string output when _stopTurn is false", () => {
    const result: ToolResult = {
      title: "ok",
      output: "hello",
      _stopTurn: false,
    };
    expect(toolResultForSdk(result)).toBe("hello");
  });

  test("error-only results return string", () => {
    const result: ToolResult = {
      title: "error",
      output: "ERROR something failed",
      isError: true,
    };
    expect(toolResultForSdk(result)).toBe("ERROR something failed");
  });
});

// ---------------------------------------------------------------------------
// Integration: runTurn truncation and turn file persistence
// ---------------------------------------------------------------------------
const capturedCalls: { parts: MessagePartType[] }[] = [];

mock.module("../../llm/client", () => ({
  streamChat: async () => {
    const call = capturedCalls.shift();
    const parts = call?.parts ?? [];
    const content = parts
      .filter((p): p is MessagePartType & { type: "text" } => p.type === "text")
      .map((p) => p.content)
      .join("");
    return { content, parts };
  },
}));

// Import runTurn AFTER the mock
const { runTurn } = await import("../../agent/turn");

function makeParts(overrides?: {
  textBefore?: string;
  toolResult?: unknown;
  textAfter?: string;
}): MessagePartType[] {
  const parts: MessagePartType[] = [];
  if (overrides?.textBefore) {
    parts.push({ type: "text", content: overrides.textBefore });
  }
  parts.push({
    type: "tool",
    toolCallId: "stop-tool",
    toolName: "agent_change",
    status: "completed",
    args: {},
    result: overrides?.toolResult ?? { title: "stop", output: "turn ended", _stopTurn: true },
  });
  if (overrides?.textAfter) {
    parts.push({ type: "text", content: overrides.textAfter });
  }
  return parts;
}

describe("runTurn _stopTurn integration", () => {
  let dataDir: string;
  let workspaceRoot: string;
  let prevEnabled: string | undefined;

  const config: ConfigFile = {
    providers: [
      {
        displayName: "Mock Provider",
        baseUrl: "http://127.0.0.1:9/v1",
        models: [{ displayName: "mock", modelName: "mock", enabled: true }],
        enabled: true,
      },
    ],
    defaultProvider: "Mock Provider",
    defaultModel: "mock",
  };

  beforeAll(async () => {
    prevEnabled = process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED;
    process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED = "0";

    const base = join(
      tmpdir(),
      `vsh-stop-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    dataDir = join(base, "data");
    workspaceRoot = join(base, "workspace");
    await mkdir(dataDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(dataDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
    // Minimal agents.md so system prompt building doesn't fail
    await writeFile(join(workspaceRoot, "agents.md"), "# agents\n");
  });

  afterAll(async () => {
    if (prevEnabled === undefined) delete process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED;
    else process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED = prevEnabled;
    // await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  test("truncates parts after stop tool, preserves text before it", async () => {
    capturedCalls.length = 0;
    capturedCalls.push({
      parts: makeParts({ textBefore: "Hello! ", toolResult: { title: "stop", output: "turn ended", _stopTurn: true }, textAfter: "should be dropped" }),
    });

    const result = await runTurn(dataDir, config, {
      content: "test message",
      workspaceRoot,
    });

    expect(result.success).toBe(true);
    expect(result.assistantMessage).not.toBeNull();

    const msg = result.assistantMessage!;

    // Parts are truncated: text + tool only (text after stop tool excluded)
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0].type).toBe("text");
    expect((msg.parts![0] as MessagePartType & { type: "text" }).content).toContain("Hello!");
    expect(msg.parts![1].type).toBe("tool");

    // The stop tool's result includes _stopTurn
    const toolPart = msg.parts![1] as MessagePartType & { type: "tool" };
    expect(toolPart.toolName).toBe("agent_change");
    expect(isStopTurnResult(toolPart.result)).toBe(true);
  });

  test("turn file on disk contains truncated parts with _stopTurn", async () => {
    capturedCalls.length = 0;
    capturedCalls.push({
      parts: makeParts({ textBefore: "Persistence. ", toolResult: { title: "stop", output: "done", _stopTurn: true } }),
    });

    const result = await runTurn(dataDir, config, {
      content: "persist test",
      workspaceRoot,
    });

    expect(result.turnId).toBeGreaterThan(0);
    expect(result.success).toBe(true);

    // Assistant message has truncated parts (text + tool, no after-stop text)
    expect(result.assistantMessage?.parts).toHaveLength(2);

    // _stopTurn flag is in the persisted tool result
    const savedTool = result.assistantMessage!.parts!.find(
      (p): p is MessagePartType & { type: "tool" } => p.type === "tool"
    );
    expect(savedTool).toBeDefined();
    expect(isStopTurnResult(savedTool!.result)).toBe(true);
  });

  test("no text before tool is fine (tool-only turn)", async () => {
    capturedCalls.length = 0;
    capturedCalls.push({
      parts: makeParts({ toolResult: { title: "stop", output: "done", _stopTurn: true } }),
    });

    const result = await runTurn(dataDir, config, {
      content: "tool only",
      workspaceRoot,
    });

    expect(result.success).toBe(true);
    expect(result.assistantMessage?.parts?.length).toBe(1);
    expect(result.assistantMessage?.parts?.[0].type).toBe("tool");
  });

  test("no _stopTurn in result does not trigger truncation", async () => {
    capturedCalls.length = 0;
    capturedCalls.push({
      parts: makeParts({
        textBefore: "Normal ",
        toolResult: { title: "ok", output: "no stop" },
        textAfter: " continues",
      }),
    });

    const result = await runTurn(dataDir, config, {
      content: "normal flow",
      workspaceRoot,
    });

    expect(result.success).toBe(true);
    // All parts preserved (no truncation)
    expect(result.assistantMessage?.parts).toHaveLength(3); // text + tool + text
  });
});
