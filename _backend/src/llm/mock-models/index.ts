import type { AsyncGenerator } from "../../../../_shared/types";
import { generateExpectedText, type MockAction } from "./shared";
import { stream as model1000 } from "./model1000";
import { stream as modelMixed } from "./model-mixed";
import { stream as modelAlltools } from "./model-alltools";
import { stream as toolsV2, actions as toolsV2Actions } from "./toolsV2";
import { stream as modelSlow } from "./model-slow";
import { stream as model5000 } from "./model5000";
import { stream as defaultModel } from "./default";
import { stream as modelFail, streamEvent as modelFailEvent } from "./model-fail";

const streamRegistry: Record<string, (speed: number, signal?: AbortSignal, workspaceRoot?: string) => AsyncGenerator<any>> = {
  model1000,
  "model-mixed": modelMixed,
  "model-alltools": modelAlltools,
  toolsV2,
  "model-slow": modelSlow,
  model5000,
  "model-fail": modelFail,
  "model-fail-event": modelFailEvent,
};

const actionRegistry: Record<string, MockAction[]> = {
  toolsV2: toolsV2Actions,
};

/**
 * Wrap a raw mock stream generator with AI SDK step events
 * so stream-llm sees start-step / finish-step as real SDK providers do.
 */
async function* wrapWithStepEvents(
  inner: AsyncGenerator<any>,
  signal?: AbortSignal,
): AsyncGenerator<any> {
  yield { type: "start-step", stepNumber: 0, request: {}, warnings: [] };
  let eventCount = 0;
  for await (const event of inner) {
    eventCount++;
    console.log(`[wrapWithStepEvents] Event #${eventCount}:`, event.type, event.toolCallId || event.toolName || "");
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    yield event;
  }
  console.log(`[wrapWithStepEvents] Inner generator finished, total events: ${eventCount}`);
  // Shape matches AI SDK TextStreamFinishStepPart (nested usage details + performance)
  yield {
    type: "finish-step",
    finishReason: "stop",
    rawFinishReason: "stop",
    usage: {
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      inputTokenDetails: {
        noCacheTokens: 40,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: {
        textTokens: 15,
        reasoningTokens: 5,
      },
      raw: { mock: true, prompt_tokens: 50, completion_tokens: 20 },
    },
    performance: {
      stepTimeMs: 100,
      responseTimeMs: 90,
      timeToFirstOutputMs: 50,
      effectiveOutputTokensPerSecond: 200,
      outputTokensPerSecond: 250,
      inputTokensPerSecond: 1000,
      effectiveTotalTokensPerSecond: 700,
      toolExecutionMs: {},
    },
    response: { id: "mock-response-id", modelId: "mock-model", timestamp: new Date() },
    providerMetadata: { mock: { provider: "Test" } },
    warnings: [],
  };
  yield {
    type: "finish",
    finishReason: "stop",
    rawFinishReason: "stop",
    totalUsage: {
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      inputTokenDetails: { noCacheTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
    },
  };
}

export function createMockFullStream(
  model: string,
  signal?: AbortSignal,
  speed = 1,
  workspaceRoot?: string,
): AsyncGenerator<any> {
  const fn = streamRegistry[model];
  const inner = fn ? fn(speed, signal, workspaceRoot) : defaultModel(speed, signal);
  return wrapWithStepEvents(inner, signal);
}

/** Generate the full expected output for a model by name. */
export function getExpectedText(modelName: string, workspaceRoot?: string): string {
  const actions = actionRegistry[modelName];
  if (!actions) throw new Error("No actions registered for model: " + modelName);
  return generateExpectedText(actions, workspaceRoot);
}
