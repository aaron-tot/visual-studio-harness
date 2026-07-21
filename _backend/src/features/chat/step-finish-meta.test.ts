import { describe, expect, test } from "bun:test";
import { flattenUsage, flattenPerformance, parseFinishStepEvent } from "./step-finish-meta";

describe("step-finish-meta", () => {
  test("flattenUsage reads nested AI SDK LanguageModelUsage", () => {
    const flat = flattenUsage({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      inputTokenDetails: {
        noCacheTokens: 80,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
      },
      outputTokenDetails: {
        textTokens: 30,
        reasoningTokens: 10,
      },
      raw: { prompt_tokens: 100 },
    });
    expect(flat.inputTokens).toBe(100);
    expect(flat.outputTokens).toBe(40);
    expect(flat.totalTokens).toBe(140);
    expect(flat.reasoningTokens).toBe(10);
    expect(flat.cacheReadTokens).toBe(20);
    expect(flat.cacheWriteTokens).toBe(5);
    expect(flat.noCacheInputTokens).toBe(80);
    expect(flat.usageRawJson).toContain("prompt_tokens");
  });

  test("flattenUsage accepts flat mock fields", () => {
    const flat = flattenUsage({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 2,
      cacheReadTokens: 3,
    });
    expect(flat.reasoningTokens).toBe(2);
    expect(flat.cacheReadTokens).toBe(3);
  });

  test("flattenPerformance reads nested performance object", () => {
    const flat = flattenPerformance({
      performance: {
        stepTimeMs: 1200,
        responseTimeMs: 1000,
        timeToFirstOutputMs: 80,
        effectiveOutputTokensPerSecond: 40,
        outputTokensPerSecond: 50,
        inputTokensPerSecond: 200,
        toolExecutionMs: { call_1: 15 },
      },
    });
    expect(flat.stepTimeMs).toBe(1200);
    expect(flat.responseTimeMs).toBe(1000);
    expect(flat.timeToFirstOutputMs).toBe(80);
    expect(flat.effectiveOutputTps).toBe(40);
    expect(flat.outputTps).toBe(50);
    expect(flat.inputTps).toBe(200);
    expect(flat.toolExecutionMsJson).toContain("call_1");
    expect(flat.performanceJson).toContain("stepTimeMs");
  });

  test("parseFinishStepEvent maps full SDK finish-step event", () => {
    const meta = parseFinishStepEvent(
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "tool_use",
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          inputTokenDetails: { cacheReadTokens: 10, cacheWriteTokens: 0, noCacheTokens: 40 },
          outputTokenDetails: { reasoningTokens: 5, textTokens: 15 },
        },
        performance: {
          stepTimeMs: 100,
          responseTimeMs: 90,
          timeToFirstOutputMs: 50,
          effectiveOutputTokensPerSecond: 200,
          outputTokensPerSecond: 250,
          inputTokensPerSecond: 1000,
          toolExecutionMs: {},
        },
        response: { id: "resp_1", modelId: "claude-4" },
        providerMetadata: { anthropic: { cache: true } },
        warnings: [],
      },
      0,
    );
    expect(meta.stepIndex).toBe(0);
    expect(meta.finishReason).toBe("tool-calls");
    expect(meta.rawFinishReason).toBe("tool_use");
    expect(meta.inputTokens).toBe(50);
    expect(meta.reasoningTokens).toBe(5);
    expect(meta.cacheReadTokens).toBe(10);
    expect(meta.stepTimeMs).toBe(100);
    expect(meta.responseId).toBe("resp_1");
    expect(meta.responseModelId).toBe("claude-4");
    expect(meta.providerMetadataJson).toContain("anthropic");
  });
});
