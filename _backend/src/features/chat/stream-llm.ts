import type { Message, MessagePartType, ThinkingEffort } from "../../../../_shared/types";
import { streamText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getBus } from "../hooks";
import { thinkingToProviderOptions } from "../../llm/thinking";
import { classifyLlmError, LlmError, isAbortError } from "../../llm/errors";
import { isStopTurnResult } from "../tools";
import { splitSystemInstructions } from "../../llm/prompt-messages";
import { assertExactlyOneSystemMessage } from "../agents/system-prompt";
import { getDescriptorByDisplayName } from "../../../../_shared/provider-registry";
import { serverOriginFromBaseUrl } from "../../llm/slots";
import { createMockFullStream } from "../../llm/mock-models";
import type { StreamChatOptions, StreamChatResult } from "./stream-types";
import { getRetryableLabel, DEFAULT_STREAM_RETRY_CONFIG } from "./stream-retry";
import { createVerboseFetch } from "./raw-capture-fetch";
import { parseFinishStepEvent, flattenUsage } from "./step-finish-meta";

function serializeToolsForDebug(tools: import("ai").ToolSet): Array<{
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}> {
  return Object.entries(tools).map(([name, tool]) => ({
    type: "function" as const,
    function: { name, description: tool.description ?? "", parameters: tool.parameters ?? { type: "object", properties: {} } },
  }));
}

export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { provider, model, messages, onToken, onReasoning, onToolCall, onToolResult, tools, maxSteps = 30, temperature, thinkingEffort, signal, hookCtx } = options;

  const errCtx = { provider: provider.displayName, model };
  const retryConfig = {
    ...DEFAULT_STREAM_RETRY_CONFIG,
    maxAttempts: options.streamRetryMaxAttempts ?? DEFAULT_STREAM_RETRY_CONFIG.maxAttempts,
    errorName: options.streamRetryErrorName ?? DEFAULT_STREAM_RETRY_CONFIG.errorName,
    delayMs: options.streamRetryDelayMs ?? DEFAULT_STREAM_RETRY_CONFIG.delayMs,
  };
  const cap = createVerboseFetch();
  const { fetch: verboseFetch, captureDone: rawCaptureDone, getResponse: getRawResponse } = cap;
  let rawResponse: Record<string, unknown> | undefined;

  const sdkProvider = provider.displayName === "Test" ? null : createOpenAICompatible({
    baseURL: provider.baseUrl, apiKey: provider.apiKey || "no-key",
    headers: provider.headers, name: provider.displayName, fetch: verboseFetch,
  });

  const hasTools = tools && Object.keys(tools).length > 0;
  const bus = hookCtx ? getBus() : null;
  const streamStarted = Date.now();
  const dbg = (...a: unknown[]) => console.log("[stream]", ...a);
  dbg("streamChat:start", { provider: provider.displayName, model, messageCount: messages.length, hasTools, maxSteps, thinkingEffort, retryMaxAttempts: retryConfig.maxAttempts });
  const emitChunks = bus != null && bus.listenerCount("stream.chunk") > 0;
  const providerOptions = thinkingToProviderOptions(thinkingEffort);

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
  let stepIndexCounter = 0;
  let streamFinishReason: string | undefined;
  let streamRawFinishReason: string | undefined;
  let streamTotalUsage: import("./stream-types").StreamChatResult["totalUsage"];
  let aborted = false;

  assertExactlyOneSystemMessage(messages);

  const { instructions, messages: chatMessages } = splitSystemInstructions(messages);

  const debugMessages = instructions ? [{ role: "system" as const, content: instructions }, ...chatMessages] : chatMessages;
  const debugRequestBody: Record<string, unknown> = {
    model, messages: debugMessages,
    ...(hasTools ? { tools: serializeToolsForDebug(tools!), tool_choice: "auto" } : {}),
    stream: true,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  };
  const debugUrl = `${provider.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

  const rawRequest: Record<string, unknown> = {
    model,
    ...(instructions ? { instructions } : {}),
    messages: chatMessages,
    ...(hasTools ? { tools: Object.keys(tools!) } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    maxSteps,
    httpBody: debugRequestBody,
  };

  const DEBUG_CHAT_MESSAGES = process.env.VISUAL_STUDIO_HARNESS_DEBUG_CHAT === "1";

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
        const result = provider.displayName === "Test"
          ? { fullStream: createMockFullStream(model, signal, options.modelSpeed, options.workspaceRoot) }
          : streamText({
              model: sdkProvider!(model),
              ...(instructions ? { instructions } : {}),
              messages: chatMessages,
              abortSignal: signal,
              maxRetries: 0,
              ...(temperature !== undefined ? { temperature } : {}),
              ...(providerOptions ? { providerOptions: providerOptions as never } : {}),
              ...(hasTools ? { tools, stopWhen: stepCountIs(maxSteps) } : {}),
              onError: ({ error }) => {
                const errObj = error?.lastError ?? error;
                const info = classifyLlmError(errObj ?? "stream error", errCtx);
                console.error(`[LLM] ${provider.displayName} / ${model}: ${info.message}`);
                if (info.isCustom && info.raw !== info.message) console.error(`[LLM] raw: ${info.raw}`);
                streamErrorInfo = info;
              },
            });

        const evtCounts: Record<string, number> = {};
        let firstEventLogged = false;
        let firstTokenLogged = false;
        let firstToolLogged = false;
        dbg("streamChat:awaiting-first-event", { attempt, provider: provider.displayName, model });
        for await (const event of result.fullStream) {
          if (turnEnded) break;
          const et = (event as { type: string }).type;
          evtCounts[et] = (evtCounts[et] ?? 0) + 1;
          if (!firstEventLogged) { dbg("streamChat:first-event", { type: et }); firstEventLogged = true; }
          if (!firstTokenLogged && (et === "text-delta" || et === "reasoning-delta")) { dbg("streamChat:first-token", { type: et }); firstTokenLogged = true; }
          if (!firstToolLogged && et === "tool-call") { dbg("streamChat:tool-call", { toolName: (event as { toolName?: string }).toolName }); firstToolLogged = true; }
          if (event.type === "start-step") {
            if (textBuffer) { parts.push({ type: "text" as const, content: textBuffer }); textBuffer = ""; }
            flushReasoning();
            // Real AI SDK start-step has no stepNumber — use local counter
            const stepIndex = typeof (event as any).stepNumber === "number"
              ? (event as any).stepNumber
              : stepIndexCounter;
            stepIndexCounter = stepIndex + 1;
            const request = (event as any).request;
            const warnings = (event as any).warnings;
            options.onStepStart?.({ stepIndex, request, warnings });
          } else if (event.type === "finish-step") {
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
            const part: MessagePartType & { type: "tool" } = { type: "tool", toolCallId, toolName, status: "running", args };
            toolParts.set(toolCallId, part); parts.push(part); onToolCall?.({ toolCallId, toolName, args }); pendingTools++;
          } else if (event.type === "tool-result") {
            const toolCallId = event.toolCallId;
            const toolName = event.toolName;
            const output = "output" in event ? event.output : "result" in event ? (event as { result?: unknown }).result : undefined;
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
            const toolCallId = event.toolCallId; const toolName = event.toolName;
            const errMsg = "error" in event ? String((event as { error?: unknown }).error) : "tool error";
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
        break;
      } catch (err: unknown) {
        if (isAbortError(err)) {
          aborted = true;
          dbg("streamChat:aborted");
          break;
        }
        const label = getRetryableLabel(err, retryConfig.errorName);
        if (attempt < retryConfig.maxAttempts && label) {
          const delay = retryConfig.delayMs * Math.pow(2, attempt);
          console.error(`[LLM] ${provider.displayName} / ${model}: ${label} — retry ${attempt + 1}/${retryConfig.maxAttempts} in ${delay / 1000}s`);
          onToken(`\n\n_[${label} — retrying in ${delay / 1000}s...]_\n\n`);
          await new Promise<void>((resolve) => {
            if (signal?.aborted) { resolve(); return; }
            const timer = setTimeout(resolve, delay);
            signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          if (signal?.aborted) { aborted = true; break; }
          continue;
        }
        dbg("streamChat:fatal-error", { label, message: String(err) });
        throw new LlmError(classifyLlmError(err, errCtx));
      }
    }
  } finally {
    if (bus && hookCtx) await bus.emit("stream.end", hookCtx, { fullContent, partCount: parts.length, durationMs: Date.now() - streamStarted });
  }

  flushReasoning();
  if (textBuffer) parts.push({ type: "text" as const, content: textBuffer });

  if (aborted && !streamFinishReason) {
    streamFinishReason = "aborted";
  }

  const finalParts = parts.length > 0 ? parts : undefined;

  await Promise.race([rawCaptureDone, new Promise<void>((r) => setTimeout(r, 3000))]);
  rawResponse = getRawResponse();

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
    if (!fullContent && parts.length === 0) throw new LlmError(streamErrorInfo);
    return {
      content: fullContent, parts: finalParts,
      steps: steps.length > 0 ? steps : undefined, totalUsage,
      finishReason: streamFinishReason, rawFinishReason: streamRawFinishReason,
      error: streamErrorInfo.message, rawError: streamErrorInfo.raw, errorIsCustom: streamErrorInfo.isCustom,
      rawRequest, rawResponse,
    };
  }

  return {
    content: fullContent, parts: finalParts,
    steps: steps.length > 0 ? steps : undefined, totalUsage,
    finishReason: streamFinishReason, rawFinishReason: streamRawFinishReason,
    rawRequest, rawResponse,
  };
}
