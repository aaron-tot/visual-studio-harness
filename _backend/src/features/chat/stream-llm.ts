import type { Message, MessagePartType, RetryEntry, ThinkingEffort } from "../../../../_shared/types";
import { streamText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getBus } from "../hooks";
import { sendToSession } from "../sessions/view-tracker";
import { thinkingToProviderOptions } from "../../llm/thinking";
import { classifyLlmError, extractProviderError, LlmError, isAbortError, type LlmErrorInfo } from "../../llm/errors";
import { identityHeaders } from "../../llm/identity";
import { isStopTurnResult } from "../tools";
import { assertExactlyOneSystemMessage } from "../mds";
import { getDescriptorByDisplayName } from "../../../../_shared/provider-registry";
import { serverOriginFromBaseUrl } from "../../llm/slots";
import { createMockFullStream } from "../../llm/mock-models";
import { ensureTestServer, buildMockTools, hasMockActions } from "../../llm/mock-models/test-server";
import type { StreamChatOptions, StreamChatResult } from "./stream-types";
import { getRetryableLabel, DEFAULT_STREAM_RETRY_CONFIG, calculateRetryDelay, canRetryInWindow, recordRetryAttempt } from "./stream-retry";
import { createVerboseFetch } from "./raw-capture-fetch";
import { parseFinishStepEvent, flattenUsage } from "./step-finish-meta";
import { StepToolBatch } from "./step-tool-batch";
import { isThinkingEffortOn, withThinkingReasoningEcho } from "./thinking-wire";

/**
 * Normalize a fetch `HeadersInit` (plain object, array of tuples, or Headers)
 * into a lowercase-keyed record so it can be persisted with step raw captures.
 */
export function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> | undefined {
  if (!init) return undefined;
  const out: Record<string, string> = {};
  if (typeof Headers !== "undefined" && init instanceof Headers) {
    init.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
    return out;
  }
  return { ...(init as Record<string, string>) };
}

export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { provider, model, messages, onToken, onReasoning, onToolCall, onToolResult, tools, maxSteps = 30, temperature, thinkingEffort, signal, hookCtx, prepareStep } = options;

  const errCtx = { provider: provider.displayName, model };
  const retryConfig = {
    ...DEFAULT_STREAM_RETRY_CONFIG,
    maxAttempts: options.streamRetryMaxAttempts ?? DEFAULT_STREAM_RETRY_CONFIG.maxAttempts,
    errorName: options.streamRetryErrorName ?? DEFAULT_STREAM_RETRY_CONFIG.errorName,
    // Backward compat: if streamRetryDelayMs is provided, use it as base and disable progressive
    baseDelayMs: options.streamRetryBaseDelayMs ?? options.streamRetryDelayMs ?? DEFAULT_STREAM_RETRY_CONFIG.baseDelayMs,
    progressiveDelayMs: options.streamRetryDelayMs != null ? 0 : (options.streamRetryProgressiveDelayMs ?? DEFAULT_STREAM_RETRY_CONFIG.progressiveDelayMs),
    windowValue: options.streamRetryWindowValue ?? DEFAULT_STREAM_RETRY_CONFIG.windowValue,
    windowUnit: options.streamRetryWindowUnit ?? DEFAULT_STREAM_RETRY_CONFIG.windowUnit,
    enabled: options.streamRetryEnabled ?? true,
  };
  let rawRequest: Record<string, unknown> | undefined;
  let rawResponse: Record<string, unknown> | undefined;
  // Per-attempt capture/provider are recreated on retry so stale exchanges don't pollute step attribution
  let lastCap: ReturnType<typeof createVerboseFetch> | undefined;

  // Test provider models with a server script (e.g. toolsV2) run through the
  // REAL SDK against the local endpoint — exercising prepareStep, the ASI
  // injection, and the true wire. Other test models keep the in-process generator.
  const isTest = provider.displayName === "Test";
  const useMockEndpoint = isTest && hasMockActions(model);
  const sdkTools = useMockEndpoint ? buildMockTools(model, options.workspaceRoot) : tools;
  // The `additional_system_info` injection is SYSTEM-ONLY: it is never registered
  // as a callable tool, so the agent cannot invoke it and it never appears in the
  // model's tool definitions. The fabricated assistant tool-call + tool-result
  // pair emitted by `prepareStep` is accepted by the SDK natively (unregistered
  // tool-results pass through); if a model ever emits such a call anyway, the SDK
  // fails loudly with NoSuchToolError.

  const makeSdkProvider = (fetchImpl: typeof fetch) =>
    isTest && !useMockEndpoint
      ? null
      : createOpenAICompatible({
          baseURL: useMockEndpoint ? ensureTestServer() : provider.baseUrl,
          apiKey: provider.apiKey || "no-key",
          headers: {
            ...(useMockEndpoint
              ? {}
              : identityHeaders({ sessionId: options.sessionId, parentSessionId: options.parentSessionId })),
            ...(useMockEndpoint ? { "x-test-speed": String(options.modelSpeed || 0) } : {}),
            ...(provider.headers ?? {}),
          },
          name: provider.displayName,
          fetch: fetchImpl,
        });

  const hasTools = sdkTools && Object.keys(sdkTools).length > 0;
  const bus = hookCtx ? getBus() : null;
  const stepBatch = new StepToolBatch({
    onBefore: async (p) => {
      await bus?.emit("step.tool_batch.before", hookCtx!, p);
      await options.onToolBatchStart?.(p);
    },
    onAfter: async (p) => {
      await bus?.emit("step.tool_batch.after", hookCtx!, p);
      await options.onToolBatchEnd?.(p);
    },
  });
  let currentStepIndex = 0;
  const streamStarted = Date.now();
  const dbg = (...a: unknown[]) => console.log("[stream]", ...a);
  dbg("streamChat:start", { provider: provider.displayName, model, messageCount: messages.length, hasTools, maxSteps, thinkingEffort, retryMaxAttempts: retryConfig.maxAttempts });
  const emitChunks = bus != null && bus.listenerCount("stream.chunk") > 0;
  // Inject OpenRouter-style fixed-provider routing (`provider.order` /
  // `allow_fallbacks`) at the TOP LEVEL of the request body. AI SDK v7 merges
  // providerOptions entries under the provider name namespace into the body
  // (non-schema keys), so the key must match the SDK's providerOptionsName
  // (displayName split on ".") — the `openaiCompatible` namespace is
  // schema-stripped and never reaches the wire.
  let providerOptions = thinkingToProviderOptions(thinkingEffort);
  const routing = options.providerRouting;
  if (routing?.order?.length) {
    const ns = provider.displayName.split(".")[0].trim();
    providerOptions = {
      ...(providerOptions ?? {}),
      [ns]: {
        provider: {
          order: routing.order,
          allow_fallbacks: routing.allowFallbacks ?? true,
        },
      },
    };
  }

  // Per-provider:model retry attempt tracking for rate limiting
  const streamRetryAttempts = new Map<string, number[]>();

  // Turn-scoped retry log (in-memory; persisted as an "error" part at finalization).
  // NOT reset per attempt — it accumulates the whole turn's failure history.
  const retryEntries: RetryEntry[] = [];

  /** Map LlmErrorInfo.kind → shared ErrorCategory (mirrors error-delivery.classifyError). */
  const kindToCategory = (kind: LlmErrorInfo["kind"] | undefined): RetryEntry["category"] => {
    switch (kind) {
      case "auth": return "auth";
      case "not_found": return "config";
      case "unreachable":
      case "timeout":
      case "network": return "network";
      case "server": return "server";
      default: return "unknown";
    }
  };

  /** Settle every pending entry (at most one exists) to a terminal status. */
  const settleRetries = (status: RetryEntry["status"]) => {
    for (const r of retryEntries) if (r.status === "pending") r.status = status;
  };

  if (bus && hookCtx) {
    await bus.emit("stream.start", hookCtx, { modelName: model, providerName: provider.displayName, messageCount: messages.length });
  }

  let fullContent = "";
  let parts: MessagePartType[] = [];
  let toolParts = new Map<string, MessagePartType & { type: "tool" }>();
  let streamErrorInfo: ReturnType<typeof classifyLlmError> | undefined;
  let textBuffer = "";
  let textAfterToolCalls = "";
  let reasoningBuffer = "";
  let pendingTools = 0;
  let turnEnded = false;

  // Step tracking
  let steps: import("./stream-types").StreamStepSummary[] = [];
  let stepExchangeStart: number[] = [];
  let stepIndexCounter = 0;
  let streamFinishReason: string | undefined;
  let streamRawFinishReason: string | undefined;
  let streamTotalUsage: import("./stream-types").StreamChatResult["totalUsage"];
  let aborted = false;

  // Stream pulse heartbeat — sends periodic "stream_pulse" to frontend to prevent 60s timeout
  let pulseInterval: ReturnType<typeof setInterval> | null = null;
  const startPulse = () => {
    if (pulseInterval) return;
    const sid = options.sessionId;
    if (!sid) return;
    pulseInterval = setInterval(() => {
      if (turnEnded || aborted) {
        clearInterval(pulseInterval!);
        pulseInterval = null;
        return;
      }
      sendToSession(sid, { type: "stream_pulse", sessionId: sid });
    }, 30_000);
  };
  const stopPulse = () => {
    if (pulseInterval) {
      clearInterval(pulseInterval);
      pulseInterval = null;
    }
  };

  assertExactlyOneSystemMessage(messages);

  // SDK v7 requires system messages as instructions param, not in messages array
  const instructions = messages[0]?.role === "system" ? messages[0].content : undefined;
  const chatMessages = instructions ? messages.slice(1) : messages;

  const DEBUG_CHAT_MESSAGES = process.env.VISUAL_STUDIO_HARNESS_DEBUG_CHAT === "1";
  const DEBUG_STREAM_EVENTS = false; // Set true for per-event verbose logging

  function flushReasoning() {
    if (reasoningBuffer) { parts.push({ type: "reasoning" as const, content: reasoningBuffer }); reasoningBuffer = ""; }
  }

  try {
    for (let attempt = 0; attempt <= retryConfig.maxAttempts; attempt++) {
      if (attempt > 0) {
        fullContent = ""; parts = []; toolParts = new Map(); streamErrorInfo = undefined;
        textBuffer = ""; reasoningBuffer = ""; textAfterToolCalls = "";
        steps = []; stepIndexCounter = 0;
        streamFinishReason = undefined; streamRawFinishReason = undefined; streamTotalUsage = undefined;
        pendingTools = 0; turnEnded = false;
        options.onRetryAttempt?.(attempt);
      }
      // Fresh capture per attempt so retried steps don't inherit stale exchanges
      lastCap = createVerboseFetch();
      // Thinking gateways (Console Go / DeepSeek-style) require reasoning_content
      // on every assistant tool-call message. ASI fabrications and rare tool-only
      // steps omit it; patch the wire body when thinking is on (see thinking-wire.ts).
      const fetchForProvider = withThinkingReasoningEcho(
        lastCap.fetch,
        isThinkingEffortOn(thinkingEffort),
      );
      const sdkProvider = makeSdkProvider(fetchForProvider);
      stepExchangeStart = [];
      if (DEBUG_CHAT_MESSAGES) {
        const ts = new Date().toISOString().slice(11, 19);
        console.log(`\n\n[${ts}] DEBUG: instructions`, instructions, "\n");
        console.log(`[${ts}] DEBUG: chatMessages`, chatMessages, "\n");
      }

      try {
        if (provider.displayName !== "Test") {
          const desc = getDescriptorByDisplayName(provider.displayName);
          if (desc && desc.authType === "none") {
            const origin = serverOriginFromBaseUrl(provider.baseUrl);
            if (origin) void fetch(`${origin}/upstream/${encodeURIComponent(model)}/`, { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() => {});
          }
        }

        dbg("streamChat:invoking-provider", { attempt, provider: provider.displayName, model, hasTools });
        const result = useMockEndpoint || provider.displayName !== "Test"
          ? streamText({
              model: sdkProvider!(model),
              ...(instructions ? { instructions } : {}),
              ...(prepareStep ? { prepareStep } : {}),
              messages: chatMessages,
              abortSignal: signal,
              maxRetries: 0,
              ...(temperature !== undefined ? { temperature } : {}),
              ...(providerOptions ? { providerOptions: providerOptions as never } : {}),
              ...(hasTools
                ? { tools: sdkTools!, stopWhen: stepCountIs(maxSteps) }
                : {}),
              onError: ({ error }) => {
                const errObj = (error as { lastError?: unknown })?.lastError ?? error;
                const info = classifyLlmError(errObj ?? "stream error", errCtx);
                console.error(`[LLM] ${provider.displayName} / ${model}: ${info.message}`);
                if (info.isCustom && info.raw !== info.message) console.error(`[LLM] raw: ${info.raw}`);
                streamErrorInfo = info;
              },
            })
          : { fullStream: createMockFullStream(model, signal, options.modelSpeed, options.workspaceRoot) };

        // Start pulse heartbeat after stream is created
        startPulse();

        const evtCounts: Record<string, number> = {};
        let firstEventLogged = false;
        let firstTokenLogged = false;
        let firstToolLogged = false;
        for await (const event of result.fullStream) {
          if (turnEnded) break;
          if (signal?.aborted) { aborted = true; break; }
          const et = (event as { type: string }).type;
          evtCounts[et] = (evtCounts[et] ?? 0) + 1;
          if (DEBUG_STREAM_EVENTS) {
            console.log(`[streamChat] Event: ${et}`, event.toolCallId || event.toolName || event.finishReason || "");
            if (!firstEventLogged) { dbg("streamChat:first-event", { type: et }); firstEventLogged = true; }
            if (!firstTokenLogged && (et === "text-delta" || et === "reasoning-delta")) { dbg("streamChat:first-token", { type: et }); firstTokenLogged = true; }
            if (!firstToolLogged && et === "tool-call") { dbg("streamChat:tool-call", { toolName: (event as { toolName?: string }).toolName }); firstToolLogged = true; }
          }
          if (event.type === "start-step") {
            if (textBuffer) { parts.push({ type: "text" as const, content: textBuffer }); textBuffer = ""; }
            flushReasoning();
            // Real AI SDK start-step has no stepNumber — use local counter
            const stepIndex = typeof (event as any).stepNumber === "number"
              ? (event as any).stepNumber
              : stepIndexCounter;
            stepIndexCounter = stepIndex + 1;
            currentStepIndex = stepIndex;
            stepBatch.start(stepIndex);
            stepExchangeStart.push(lastCap!.getExchanges().length);
            const request = (event as any).request;
            const warnings = (event as any).warnings;
            options.onStepStart?.({ stepIndex, request, warnings });
          } else if (event.type === "finish-step") {
            await stepBatch.fireBefore();
            await stepBatch.fireAfter();
            if (textBuffer) { parts.push({ type: "text" as const, content: textBuffer }); textBuffer = ""; }
            flushReasoning();
            // Prefer last started index (counter already advanced on start-step)
            const fallbackIndex = Math.max(0, stepIndexCounter - 1);
            const meta = parseFinishStepEvent(event, fallbackIndex);
            steps.push({
              stepIndex: meta.stepIndex,
              finishReason: meta.finishReason,
              rawFinishReason: meta.rawFinishReason,
              usage: meta.usage,
              inputTokens: meta.inputTokens,
              outputTokens: meta.outputTokens,
              totalTokens: meta.totalTokens,
              reasoningTokens: meta.reasoningTokens,
              cacheReadTokens: meta.cacheReadTokens,
              cacheWriteTokens: meta.cacheWriteTokens,
              noCacheInputTokens: meta.noCacheInputTokens,
              stepTimeMs: meta.stepTimeMs,
              responseTimeMs: meta.responseTimeMs,
              timeToFirstOutputMs: meta.timeToFirstOutputMs,
              effectiveOutputTps: meta.effectiveOutputTps,
              outputTps: meta.outputTps,
              inputTps: meta.inputTps,
              responseId: meta.responseId,
              responseModelId: meta.responseModelId,
              warnings: meta.warnings,
              meta,
            });
            options.onStepFinish?.(meta);
          } else if (event.type === "text-delta") {
            flushReasoning();
            const delta = "text" in event ? (event as { text?: string }).text : "delta" in event ? (event as { delta?: string }).delta : undefined;
            const chunk = delta ?? "";
            if (chunk) {
              if (pendingTools > 0) {
                textAfterToolCalls += chunk;
              } else {
                fullContent += chunk; textBuffer += chunk; onToken(chunk);
                if (emitChunks && bus && hookCtx) void bus.emit("stream.chunk", hookCtx, { delta: chunk, accumulatedLength: fullContent.length });
              }
            }
          } else if (event.type === "reasoning-delta") {
            const chunk = "text" in event ? (event as { text?: string }).text : "delta" in event ? (event as { delta?: string }).delta : "";
            if (chunk) { reasoningBuffer += chunk; onReasoning?.(chunk); }
          } else if (event.type === "tool-call") {
            flushReasoning();
            if (textBuffer) { parts.push({ type: "text" as const, content: textBuffer }); textBuffer = ""; }
            const toolCallId = event.toolCallId;
            const toolName = event.toolName;
            const args = "input" in event ? event.input : (event as { args?: unknown }).args;
            const part: MessagePartType & { type: "tool" } = { type: "tool", toolCallId, toolName, status: "running", args, stepIndex: currentStepIndex };
            toolParts.set(toolCallId, part); parts.push(part); onToolCall?.({ toolCallId, toolName, args, stepIndex: currentStepIndex }); pendingTools++;
            stepBatch.addCall({ toolCallId, toolName, args });
          } else if (event.type === "tool-result") {
            await stepBatch.fireBefore();
            const toolCallId = event.toolCallId;
            const toolName = event.toolName;
            const output = "output" in event ? event.output : "result" in event ? (event as { result?: unknown }).result : undefined;
            stepBatch.addResult(toolCallId, output);
            const existing = toolParts.get(toolCallId);
            if (existing) { existing.status = "completed"; existing.result = output; }
            else { parts.push({ type: "tool", toolCallId, toolName, status: "completed", args: {}, result: output } as any); }
            onToolResult?.({ toolCallId, toolName, output }); pendingTools--;
            if (isStopTurnResult(output)) { textAfterToolCalls = ""; turnEnded = true; }
            if (pendingTools === 0 && textAfterToolCalls) {
              fullContent += textAfterToolCalls; onToken(textAfterToolCalls);
              if (emitChunks && bus && hookCtx) void bus.emit("stream.chunk", hookCtx, { delta: textAfterToolCalls, accumulatedLength: fullContent.length });
              parts.push({ type: "text" as const, content: textAfterToolCalls }); textBuffer = ""; textAfterToolCalls = "";
            }
          } else if (event.type === "tool-error") {
            await stepBatch.fireBefore();
            const toolCallId = event.toolCallId; const toolName = event.toolName;
            const errMsg = "error" in event ? String((event as { error?: unknown }).error) : "tool error";
            stepBatch.addResult(toolCallId, errMsg, true);
            const existing = toolParts.get(toolCallId);
            if (existing) { existing.status = "error"; existing.error = errMsg; existing.result = errMsg; }
            onToolResult?.({ toolCallId, toolName, output: errMsg, isError: true });
          } else if (event.type === "error") {
            const err = "error" in event ? (event as { error?: unknown }).error : undefined;
            dbg("streamChat:stream-error-event", { raw: String(err) });
            streamErrorInfo = classifyLlmError(err ?? "stream error", errCtx);
            // Some SDK surfaces report mid-stream failures as an event rather than
            // throwing. Retry on a matching label so the feature fires regardless
            // of which mechanism the provider uses.
            const label = getRetryableLabel(err, retryConfig.errorName);
            if (label && attempt < retryConfig.maxAttempts) {
              throw err instanceof Error ? err : new Error(String(err));
            }

            // Log provider error that won't be retried (exhausted retries or non-retryable)
            // Only log if we have a retry config and this looks like a provider error
            if (retryConfig.enabled && label) {
              const retryInfo = streamErrorInfo!;
              const providerError = extractProviderError(err);
              const errorCode = providerError && typeof providerError.code === "number" ? providerError.code : null;
              retryEntries.push({
                attempt: attempt + 1,
                maxAttempts: retryConfig.maxAttempts,
                message: retryInfo.message,
                raw: retryInfo.raw && retryInfo.raw !== retryInfo.message ? retryInfo.raw : undefined,
                isCustom: retryInfo.isCustom,
                category: kindToCategory(retryInfo.kind),
                errorLabel: label,
                errorCode,
                errorTime: new Date().toISOString(),
                delayMs: 0,
                wasRetried: false,
                status: "failed",
              });
            }
          } else if (event.type === "finish") {
            // AI SDK: totalUsage + finishReason on finish event
            const fin = event as any;
            streamFinishReason = fin.finishReason ?? streamFinishReason;
            streamRawFinishReason = fin.rawFinishReason ?? streamRawFinishReason;
            const tu = fin.totalUsage ?? fin.usage;
            if (tu) {
              const flat = flattenUsage(tu);
              streamTotalUsage = {
                inputTokens: flat.inputTokens,
                outputTokens: flat.outputTokens,
                totalTokens: flat.totalTokens,
                reasoningTokens: flat.reasoningTokens,
                cacheReadTokens: flat.cacheReadTokens,
                cacheWriteTokens: flat.cacheWriteTokens,
              };
            }
          }
        }
        dbg("streamChat:stream-done", { attempt, evtCounts, partsLen: parts.length, finishReason: streamFinishReason });
        // The stream completed — the retry (if any) that led to this attempt
        // succeeded, UNLESS an error event was recorded during the stream.
        if (attempt > 0 && !streamErrorInfo) settleRetries("succeeded");
        stopPulse();
        break;
      } catch (err: unknown) {
        if (isAbortError(err)) {
          aborted = true;
          stopPulse();
          dbg("streamChat:aborted");
          break;
        }
        const label = getRetryableLabel(err, retryConfig.errorName);
        if (retryConfig.enabled && attempt < retryConfig.maxAttempts && label) {
          // Check rate limit window
          if (!canRetryInWindow(streamRetryAttempts, provider.displayName + ":" + model, retryConfig.maxAttempts, retryConfig.windowValue, retryConfig.windowUnit)) {
            dbg("streamChat:rate-limited", { provider: provider.displayName, model });
            settleRetries("failed");
            const rlInfo = classifyLlmError(err, errCtx);
            retryEntries.push({
              attempt: attempt + 1,
              maxAttempts: retryConfig.maxAttempts,
              message: rlInfo.message,
              raw: rlInfo.raw && rlInfo.raw !== rlInfo.message ? rlInfo.raw : undefined,
              isCustom: rlInfo.isCustom,
              category: kindToCategory(rlInfo.kind),
              errorLabel: label,
              errorCode: null,
              errorTime: new Date().toISOString(),
              delayMs: 0,
              wasRetried: false,
              rateLimited: true,
              status: "failed",
            });
            const rlError = new LlmError(rlInfo);
            rlError.retries = retryEntries;
            throw rlError;
          }
          recordRetryAttempt(streamRetryAttempts, provider.displayName + ":" + model);
          const delay = calculateRetryDelay(attempt, retryConfig.baseDelayMs, retryConfig.progressiveDelayMs);
          console.error(`[LLM] ${provider.displayName} / ${model}: ${label} — retry ${attempt + 1}/${retryConfig.maxAttempts} in ${delay / 1000}s`);

          // Extract error code from provider error if available
          const providerError = extractProviderError(err);
          const errorCode = providerError && typeof providerError.code === "number" ? providerError.code : null;

          // Record the failure in the turn's retry log (persisted as an "error"
          // part at finalization — mid-turn writes would be wiped by clearTurnSteps).
          // The previous pending entry's retry just failed too.
          settleRetries("failed");
          const retryInfo = classifyLlmError(err, errCtx);
          const retryEntry: RetryEntry = {
            attempt: attempt + 1,
            maxAttempts: retryConfig.maxAttempts,
            message: retryInfo.message,
            raw: retryInfo.raw && retryInfo.raw !== retryInfo.message ? retryInfo.raw : undefined,
            isCustom: retryInfo.isCustom,
            category: kindToCategory(retryInfo.kind),
            errorLabel: label,
            errorCode,
            errorTime: new Date().toISOString(),
            delayMs: delay,
            wasRetried: true,
            status: "pending",
          };
          retryEntries.push(retryEntry);
          // Live countdown + error part are driven by the caller (run-turn) so it
          // can attach a monotonic seq — no direct sendToSession here.
          options.onRetryError?.(retryEntry);

          // Retry-tick/end countdown events are still emitted from here.
          const sid = options.sessionId;

          // Wait with periodic retry_tick emissions
          let abortedDuringWait = false;
          await new Promise<void>((resolve) => {
            if (signal?.aborted) {
              abortedDuringWait = true;
              resolve();
              return;
            }
            const startWait = Date.now();
            const endWait = startWait + delay;
            const tickInterval = setInterval(() => {
              const remainingMs = endWait - Date.now();
              if (remainingMs <= 0) {
                clearInterval(tickInterval);
                return;
              }
              if (sid) {
                sendToSession(sid, {
                  type: "retry_tick",
                  sessionId: sid,
                  remainingMs,
                });
              }
            }, 1000);
            const timer = setTimeout(() => {
              clearInterval(tickInterval);
              resolve();
            }, delay);
            signal?.addEventListener("abort", () => {
              clearInterval(tickInterval);
              clearTimeout(timer);
              abortedDuringWait = true;
              resolve();
            }, { once: true });
          });

          // Emit retry_end
          if (sid) {
            sendToSession(sid, {
              type: "retry_end",
              sessionId: sid,
              aborted: abortedDuringWait,
            });
          }

          if (signal?.aborted || abortedDuringWait) {
            settleRetries("aborted");
            aborted = true;
            stopPulse();
            break;
          }
          stopPulse();
          continue;
        }
        dbg("streamChat:fatal-error", { label, message: String(err) });
        settleRetries("failed");
        const fatalInfo = classifyLlmError(err, errCtx);
        const fatalError = new LlmError(fatalInfo);
        fatalError.retries = retryEntries;
        throw fatalError;
      }
    }
  } finally {
    stopPulse();
    if (bus && hookCtx) await bus.emit("stream.end", hookCtx, { fullContent, partCount: parts.length, durationMs: Date.now() - streamStarted });
  }

  flushReasoning();
  if (textBuffer) parts.push({ type: "text" as const, content: textBuffer });

  if (aborted && !streamFinishReason) {
    streamFinishReason = "aborted";
  }

  const finalParts = parts.length > 0 ? parts : undefined;

  await Promise.race([lastCap?.captureDone, new Promise<void>((r) => setTimeout(r, 3000))]);
  rawResponse = lastCap?.getResponse();
  rawRequest = lastCap?.getRequest() ?? undefined;

  // Attribute captured exchanges to their step: step N owns exchanges from its
  // recorded start up to the start of step N+1 (usually exactly one per step).
  if (lastCap && stepExchangeStart.length > 0) {
    const exchanges = lastCap.getExchanges();
    steps.forEach((s, idx) => {
      const start = stepExchangeStart[idx];
      if (start === undefined) return;
      const end = idx + 1 < stepExchangeStart.length ? stepExchangeStart[idx + 1] : exchanges.length;
      const own = exchanges.slice(start, end);
      const req = own[0]?.request;
      const resp = own[own.length - 1]?.response;
      const reqHeaders = normalizeHeaders(own[0]?.requestHeaders);
      if (req !== undefined && reqHeaders && Object.keys(reqHeaders).length > 0) {
        s.rawRequest = { ...req, headers: reqHeaders };
      } else if (req !== undefined) {
        s.rawRequest = req;
      } else if (reqHeaders && Object.keys(reqHeaders).length > 0) {
        s.rawRequest = { headers: reqHeaders };
      }
      if (resp !== undefined) s.rawResponse = resp;
    });
  }

  const totalUsage = streamTotalUsage ?? (steps.length > 0
    ? {
        inputTokens: steps.reduce((s, st) => s + (st.inputTokens ?? st.usage?.inputTokens ?? 0), 0),
        outputTokens: steps.reduce((s, st) => s + (st.outputTokens ?? st.usage?.outputTokens ?? 0), 0),
        totalTokens: steps.reduce((s, st) => s + (st.totalTokens ?? st.usage?.totalTokens ?? 0), 0),
        reasoningTokens: steps.reduce((s, st) => s + (st.reasoningTokens ?? 0), 0),
        cacheReadTokens: steps.reduce((s, st) => s + (st.cacheReadTokens ?? 0), 0),
        cacheWriteTokens: steps.reduce((s, st) => s + (st.cacheWriteTokens ?? 0), 0),
      }
    : undefined);

  if (streamErrorInfo) {
    settleRetries("failed");
    if (!fullContent && parts.length === 0) {
      const streamErr = new LlmError(streamErrorInfo);
      streamErr.retries = retryEntries;
      throw streamErr;
    }
    return {
      content: fullContent, parts: finalParts,
      steps: steps.length > 0 ? steps : undefined, totalUsage,
      retries: retryEntries.length > 0 ? retryEntries : undefined,
      finishReason: streamFinishReason, rawFinishReason: streamRawFinishReason,
      error: streamErrorInfo.message, rawError: streamErrorInfo.raw, errorIsCustom: streamErrorInfo.isCustom,
      rawRequest, rawResponse,
    };
  }

  return {
    content: fullContent, parts: finalParts,
    steps: steps.length > 0 ? steps : undefined, totalUsage,
    retries: retryEntries.length > 0 ? retryEntries : undefined,
    finishReason: streamFinishReason, rawFinishReason: streamRawFinishReason,
    rawRequest, rawResponse,
  };
}
