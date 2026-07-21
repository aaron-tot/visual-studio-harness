/**
 * Map AI SDK fullStream finish-step / usage / performance shapes into
 * column-ready fields for steps table. Supports both real SDK nested shapes
 * and flatter mock events.
 */
import type { LanguageModelUsage, FinishReason } from "ai";

export interface StepFinishMeta {
  stepIndex: number;
  finishReason?: FinishReason | string;
  rawFinishReason?: string;
  usage?: Partial<LanguageModelUsage>;
  /** Flattened usage columns */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheInputTokens?: number;
  usageRawJson?: string;
  /** Performance columns */
  stepTimeMs?: number;
  responseTimeMs?: number;
  timeToFirstOutputMs?: number;
  effectiveOutputTps?: number;
  outputTps?: number;
  inputTps?: number;
  toolExecutionMsJson?: string;
  performanceJson?: string;
  /** Response / provider */
  response?: unknown;
  responseId?: string;
  responseModelId?: string;
  providerMetadataJson?: string;
  warnings?: unknown[];
  warningsJson?: string;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Extract nested LanguageModelUsage fields into flat token columns. */
export function flattenUsage(usage: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheInputTokens?: number;
  usageRawJson?: string;
} {
  if (!usage || typeof usage !== "object") return {};
  const u = usage as Record<string, unknown>;
  const inputDetails = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  const outputDetails = (u.outputTokenDetails ?? {}) as Record<string, unknown>;
  const raw = u.raw;
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    // SDK nested path + flat fallback (older mocks)
    reasoningTokens: num(outputDetails.reasoningTokens) ?? num(u.reasoningTokens),
    cacheReadTokens: num(inputDetails.cacheReadTokens) ?? num(u.cacheReadTokens),
    cacheWriteTokens: num(inputDetails.cacheWriteTokens) ?? num(u.cacheWriteTokens),
    noCacheInputTokens: num(inputDetails.noCacheTokens) ?? num(u.noCacheTokens),
    usageRawJson: raw !== undefined ? JSON.stringify(raw) : JSON.stringify(usage),
  };
}

/** Extract StepResultPerformance (or flat mock fields) into columns. */
export function flattenPerformance(event: Record<string, unknown>): {
  stepTimeMs?: number;
  responseTimeMs?: number;
  timeToFirstOutputMs?: number;
  effectiveOutputTps?: number;
  outputTps?: number;
  inputTps?: number;
  toolExecutionMsJson?: string;
  performanceJson?: string;
} {
  const perf = (event.performance && typeof event.performance === "object"
    ? event.performance
    : null) as Record<string, unknown> | null;

  const stepTimeMs = num(perf?.stepTimeMs) ?? num(event.stepTimeMs);
  const responseTimeMs = num(perf?.responseTimeMs) ?? num(event.responseTimeMs);
  const timeToFirstOutputMs = num(perf?.timeToFirstOutputMs) ?? num(event.timeToFirstOutputMs);
  const effectiveOutputTps = num(perf?.effectiveOutputTokensPerSecond) ?? num(event.effectiveOutputTokensPerSecond);
  const outputTps = num(perf?.outputTokensPerSecond) ?? num(event.outputTokensPerSecond);
  const inputTps = num(perf?.inputTokensPerSecond) ?? num(event.inputTokensPerSecond);
  const toolMs = perf?.toolExecutionMs ?? event.toolExecutionMs;
  const performanceJson = perf
    ? JSON.stringify(perf)
    : (stepTimeMs != null || responseTimeMs != null)
      ? JSON.stringify({
          stepTimeMs,
          responseTimeMs,
          timeToFirstOutputMs,
          effectiveOutputTokensPerSecond: effectiveOutputTps,
          outputTokensPerSecond: outputTps,
          inputTokensPerSecond: inputTps,
          toolExecutionMs: toolMs,
        })
      : undefined;

  return {
    stepTimeMs,
    responseTimeMs,
    timeToFirstOutputMs,
    effectiveOutputTps,
    outputTps,
    inputTps,
    toolExecutionMsJson: toolMs !== undefined ? JSON.stringify(toolMs) : undefined,
    performanceJson,
  };
}

/**
 * Parse a fullStream `finish-step` event into persistable step meta.
 * `stepIndexFallback` used when event has no stepNumber (real AI SDK finish-step).
 */
export function parseFinishStepEvent(
  event: unknown,
  stepIndexFallback: number,
): StepFinishMeta {
  const e = (event && typeof event === "object" ? event : {}) as Record<string, unknown>;
  const usage = e.usage;
  const flatUsage = flattenUsage(usage);
  const flatPerf = flattenPerformance(e);
  const response = e.response as Record<string, unknown> | undefined;
  const warnings = e.warnings as unknown[] | undefined;
  const providerMetadata = e.providerMetadata;

  const stepIndex =
    typeof e.stepNumber === "number" ? e.stepNumber : stepIndexFallback;

  return {
    stepIndex,
    finishReason: e.finishReason as FinishReason | string | undefined,
    rawFinishReason: typeof e.rawFinishReason === "string" ? e.rawFinishReason : undefined,
    usage: usage as Partial<LanguageModelUsage> | undefined,
    ...flatUsage,
    ...flatPerf,
    response,
    responseId: response && typeof response.id === "string" ? response.id : undefined,
    responseModelId: response && typeof response.modelId === "string" ? response.modelId : undefined,
    providerMetadataJson: providerMetadata !== undefined ? JSON.stringify(providerMetadata) : undefined,
    warnings,
    warningsJson: warnings !== undefined ? JSON.stringify(warnings) : undefined,
  };
}
