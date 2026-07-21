import { describe, expect, test } from "bun:test";
import { streamChat } from "./client";
import type { ProviderConfig } from "../../../_shared/types";

const testProvider: ProviderConfig = {
  displayName: "Test",
  baseUrl: "http://localhost:1/test",
  models: [{ displayName: "test", modelName: "test" }],
};

describe("streamChat - test provider", () => {
  test("returns static response without calling any LLM", async () => {
    const tokens: string[] = [];
    const result = await streamChat({
      provider: testProvider,
      model: "test",
      messages: [
        { role: "system", content: "system", timestamp: new Date().toISOString() },
        { role: "user", content: "hi", timestamp: new Date().toISOString() },
      ],
      onToken: (t) => tokens.push(t),
    });

    expect(result.content).toBe("Hello this is a test. not from a llm");
    expect(tokens.length).toBeGreaterThan(0);
  });

  test("returns partial data on abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await streamChat({
      provider: testProvider,
      model: "test",
      messages: [
        { role: "system", content: "system", timestamp: new Date().toISOString() },
        { role: "user", content: "hi", timestamp: new Date().toISOString() },
      ],
      onToken: () => {},
      signal: controller.signal,
    });
    expect(result.finishReason).toBe("aborted");
  });
});
