import { describe, expect, test } from "bun:test";
import {
  ensureThinkingReasoningContent,
  isThinkingEffortOn,
  withThinkingReasoningEcho,
} from "./thinking-wire";

describe("isThinkingEffortOn", () => {
  test("off / empty / undefined are off", () => {
    expect(isThinkingEffortOn(undefined)).toBe(false);
    expect(isThinkingEffortOn(null)).toBe(false);
    expect(isThinkingEffortOn("")).toBe(false);
    expect(isThinkingEffortOn("off")).toBe(false);
  });
  test("medium/high/low are on", () => {
    expect(isThinkingEffortOn("medium")).toBe(true);
    expect(isThinkingEffortOn("high")).toBe(true);
    expect(isThinkingEffortOn("low")).toBe(true);
  });
});

describe("ensureThinkingReasoningContent", () => {
  test("adds empty reasoning_content to assistant tool-call msgs missing it", () => {
    const body = {
      model: "deepseek-v4-flash",
      reasoning_effort: "medium",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "ok",
          reasoning_content: "thought",
          tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "c1", content: "out" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "asi-1", type: "function", function: { name: "additional_system_info", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "asi-1", content: "<additional_system_info/>" },
      ],
    };
    ensureThinkingReasoningContent(body);
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs[2].reasoning_content).toBe("thought");
    expect(msgs[4].reasoning_content).toBe("");
    expect("reasoning_content" in msgs[4]).toBe(true);
  });

  test("does not overwrite existing reasoning_content", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: null,
          reasoning_content: "keep-me",
          tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{}" } }],
        },
      ],
    };
    ensureThinkingReasoningContent(body);
    expect((body.messages[0] as { reasoning_content: string }).reasoning_content).toBe("keep-me");
  });

  test("leaves non-tool assistant and non-assistant msgs alone", () => {
    const body = {
      messages: [
        { role: "assistant", content: "plain text only" },
        { role: "user", content: "u" },
      ],
    };
    ensureThinkingReasoningContent(body);
    expect("reasoning_content" in (body.messages[0] as object)).toBe(false);
    expect("reasoning_content" in (body.messages[1] as object)).toBe(false);
  });
});

describe("withThinkingReasoningEcho", () => {
  test("when thinking off, passes body through unchanged", async () => {
    let seen: string | undefined;
    const base = Object.assign(
      async (_i: unknown, init?: RequestInit) => {
        seen = typeof init?.body === "string" ? init.body : undefined;
        return new Response("ok");
      },
      { preconnect: async () => {} },
    ) as typeof fetch;
    const f = withThinkingReasoningEcho(base, false);
    const body = JSON.stringify({
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "a", type: "function", function: { name: "additional_system_info", arguments: "{}" } }],
        },
      ],
    });
    await f("http://x", { method: "POST", body });
    expect(seen).toBe(body);
    expect(JSON.parse(seen!).messages[0].reasoning_content).toBeUndefined();
  });

  test("when thinking on, injects reasoning_content on wire", async () => {
    let seen: string | undefined;
    const base = Object.assign(
      async (_i: unknown, init?: RequestInit) => {
        seen = typeof init?.body === "string" ? init.body : undefined;
        return new Response("ok");
      },
      { preconnect: async () => {} },
    ) as typeof fetch;
    const f = withThinkingReasoningEcho(base, true);
    await f("http://x", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "a", type: "function", function: { name: "additional_system_info", arguments: "{}" } }],
          },
        ],
      }),
    });
    const parsed = JSON.parse(seen!);
    expect(parsed.messages[0].reasoning_content).toBe("");
  });
});
