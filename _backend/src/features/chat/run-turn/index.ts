import { join } from "node:path";
import type { ConfigFile, Message, MessagePartType, ThinkingEffort } from "../../../_shared/types";
import {
  createSession,
  getSession,
  writeSessionSystemPrompt,
  updateSessionTimestamp,
  updateSessionWorkspace,
  updateSessionAgentName,
} from "../../sessions/store";
import { streamChat } from "../stream-llm";
import { classifyLlmError, LlmError, type LlmErrorInfo } from "../../../llm/errors";
import {
  createDefaultRegistry,
  getWorkspaceRoot,
  toolsEnabled,
  setTodoDataDir,
  setSkillRoots,
  isStopTurnResult,
  type ResolveContext,
} from "../../tools";
import { normalizeWorkspace } from "../../sessions/rest";
import { getMcpManager } from "../../mcp";
import {
  buildHookContext,
  withHookContext,
  getBus,
  type HookSource,
  type HookContext,
} from "../../hooks";
import { resolveRuntimeFromSettings, getAgentSettings, resolveSessionRuntime, type ResolvedRuntime } from "../../agents/runtime-settings";
import { readAgent } from "../../agents/rest";
import {
  assertExactlyOneSystemMessage,
  buildSystemBlock,
  messagesForModel,
} from "../../agents/system-prompt";
import { getMode } from "../../../paths";
import { createStepStreamWriter } from "../persist-stream";
import { buildErrorAssistantMessage } from "../turn-errors";
import {
  getNextTurnNumber,
  createTurn,
  insertTurnContext,
  ensurePromptSnapshot,
  ensureToolsSnapshot,
  updateTurnSnapshots,
  createStep,
  finalizeStep,
  clearTurnSteps,
  finalizeTurnTrace,
  abortTurnTrace,
  updateTurnRawCapture,
} from "../db-trace";
import { resolveContextTurnIds, buildModelMessagesFromContext } from "../project-chat";
import type { TurnCreateMeta, TurnInput, TurnEvents, TurnResult } from "../types";
import { generateId, autoTitle, isAbortError } from "./util";
export { isAbortError } from "./util";
import { registerSession, unregisterSession } from "../../../session/runtime";

export async function runTurn(
  dataDir: string,
  config: ConfigFile,
  input: TurnInput,
  events: TurnEvents = {}
): Promise<TurnResult> {
  const content = (input.content || "").trim();
  if (!content) throw new Error("content is required");

  const agentName = input.agentName?.trim();
  const rawId = (input.sessionId || "").trim();
  const isNew = !rawId || rawId === "new";
  let sessionId = isNew ? generateId() : rawId;

  let runtime: ResolvedRuntime;

  if (isNew) {
    const baseSettings: import("../../_shared/types").AgentSettings = {
      providerName: config.defaultProvider,
      modelName: config.defaultModel,
      thinking: { effort: "off" },
    };
    if (agentName) {
      const agent = await readAgent(dataDir, agentName);
      if (agent) Object.assign(baseSettings, agent);
    }
    if (input.providerName) baseSettings.providerName = input.providerName;
    if (input.modelName) baseSettings.modelName = input.modelName;
    if (input.thinkingEffort) baseSettings.thinking = { effort: input.thinkingEffort };
    const merged = getAgentSettings(baseSettings, config);
    runtime = resolveRuntimeFromSettings(merged, config.providers);
  } else {
    const existing = await getSession(dataDir, sessionId);
    if (!existing) throw new Error("Session not found");
    runtime = await resolveSessionRuntime(dataDir, existing.meta, config);
  }
  const provider = runtime.provider;
  const model = runtime.model;

  const turnStarted = Date.now();
  const source: HookSource = events.source ?? "internal";
  let hookCtx: HookContext = buildHookContext({
    dataDir, source, signal: events.signal,
    sessionId: input.sessionId && input.sessionId !== "new" ? input.sessionId : undefined,
  });
  const bus = getBus();
  await bus?.emit("message.received", hookCtx, { content, sessionId: input.sessionId });

  let created = false;
  let workspaceRoot: string;

  if (isNew) {
    const wsInput = input.workspaceRoot?.trim() || getWorkspaceRoot();
    const norm = normalizeWorkspace(wsInput);
    if ("error" in norm) throw new Error(norm.error);
    workspaceRoot = norm.path;
    const kind = input.createMeta?.kind ?? "primary";
    const meta = {
      id: sessionId,
      title: input.createMeta?.title?.trim() || autoTitle(content),
      providerName: provider.displayName,
      modelName: model.displayName,
      thinkingEffort: runtime.thinkingEffort,
      workspaceRoot,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      kind,
      parentId: input.createMeta?.parentId,
      taskLabel: input.createMeta?.taskLabel,
      agentName: agentName || undefined,
    };
    await createSession(dataDir, meta);
    created = true;
  } else {
    const existing = await getSession(dataDir, sessionId);
    if (!existing) throw new Error("Session not found");
    if (!existing.meta.workspaceRoot?.trim()) {
      const wsInput = input.workspaceRoot?.trim() || getWorkspaceRoot();
      const norm = normalizeWorkspace(wsInput);
      if ("error" in norm) throw new Error(norm.error);
      workspaceRoot = norm.path;
      await updateSessionWorkspace(dataDir, sessionId, workspaceRoot);
    } else {
      workspaceRoot = existing.meta.workspaceRoot;
    }
    if (agentName !== undefined && agentName !== existing.meta.agentName) {
      await updateSessionAgentName(dataDir, sessionId, agentName);
    }
  }

  hookCtx = withHookContext(hookCtx, {
    sessionId, workspaceRoot,
    providerName: provider.displayName,
    modelName: model.displayName,
    signal: events.signal,
  });

  const userMessage: Message = {
    role: "user", content,
    timestamp: new Date().toISOString(),
  };

  // ── Trace schema: create turn ────────────────────────────────────
  const turnNumber = getNextTurnNumber(sessionId, dataDir);
  const turnTimestamp = new Date().toISOString();
  const traceTurnId = createTurn(sessionId, turnNumber, content, turnTimestamp, {
    agentName: agentName ?? undefined,
    modelName: model.displayName,
    providerName: provider.displayName,
    maxSteps: runtime.maxSteps,
    temperature: runtime.temperature,
    thinkingEffort: runtime.thinkingEffort,
  }, dataDir);

  // ── Context refs ─────────────────────────────────────────────────
  const contextTurnIds = resolveContextTurnIds(sessionId, dataDir);
  insertTurnContext(traceTurnId, contextTurnIds, dataDir);

  await bus?.emit("message.user_persisted", hookCtx, { message: userMessage, sessionId });
  const session = await getSession(dataDir, sessionId);
  if (!session) throw new Error("Session not found after create");
  events.onSessionReady?.({ sessionId, created, meta: session.meta, turnId: turnNumber });
  await bus?.emit("turn.start", hookCtx, { sessionId, created, meta: session.meta, workspaceRoot });

  const useTools = toolsEnabled();
  const mcpTools = getMcpManager().getTools();
  const registry = useTools
    ? createDefaultRegistry({ exclude: input.excludeTools, extraTools: mcpTools }, config.agents)
    : null;

  setTodoDataDir(dataDir);
  setSkillRoots([
    join(workspaceRoot, ".visual-studio-harness", "skills"),
    join(workspaceRoot, "skills"),
    join(workspaceRoot, "source", "skills"),
    join(dataDir, "skills"),
  ]);

  const abortSignal = events.signal;
  let turnEnded = false;

  const bridgePermission = events.askPermission
    ? (toolName: string, args: unknown, callId: string) => events.askPermission!(toolName, args, callId)
    : undefined;

  const sessionAbortController = new AbortController();
  registerSession(sessionId, sessionAbortController, traceTurnId);

  try {
    let partSeq = 0;
    const resolveCtx: ResolveContext = { dataDir, sessionId, workspaceRoot };
    const tools = registry
      ? await registry.toFilteredAiSdkTools((callId) => ({
          sessionId, turnId: traceTurnId, workspaceRoot, dataDir,
          abortSignal: abortSignal ?? new AbortController().signal,
          callId, hookCtx,
          askPermission: async (toolName, args) => {
            events.onToolUpdate?.({ toolCallId: callId, status: "awaiting_permission" });
            if (events.askPermission) return events.askPermission(toolName, args, callId);
            return true;
          },
          bridgePermission,
          bridgeToolCall: events.onToolCall,
          bridgeToolResult: events.onToolResult,
          bridgeToolUpdate: events.onToolUpdate,
          requestSubagentConfig: events.requestSubagentConfig
            ? async (req) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_config" });
                return events.requestSubagentConfig!(req);
              }
            : undefined,
          requestSlotBusyDecision: events.requestSlotBusyDecision
            ? async (req) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_config" });
                return events.requestSlotBusyDecision!(req);
              }
            : undefined,
          requestAgentChange: events.requestAgentChange
            ? async (req) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_agent_change" });
                return events.requestAgentChange!(req);
              }
            : undefined,
          abortTurn: events.abortTurn,
          onSlotWaitStart: events.onSlotWaitStart,
          onSlotWaitStatus: events.onSlotWaitStatus,
          onSlotWaitEnd: events.onSlotWaitEnd,
        }), resolveCtx)
      : undefined;

    const noSystemPrompt = input.noSystemPrompt ?? false;
    const systemBlock = await buildSystemBlock({
      dataDir, workspaceRoot, mode: getMode(), sessionId,
      agentSettings: runtime.settings, noSystemPrompt,
      systemPromptJoiners: config.systemPromptJoiners,
    });

    // Build model messages from trace context turns
    const contextMessages = buildModelMessagesFromContext(contextTurnIds, systemBlock, dataDir);
    const modelMessages = [...contextMessages, { ...userMessage, turnId: turnNumber }];
    assertExactlyOneSystemMessage(modelMessages);
    await writeSessionSystemPrompt(dataDir, sessionId, systemBlock);

    let resolvedThinkingEffort = runtime.thinkingEffort;
    if (sessionId) {
      try {
        const { getSessionModelConfigJson } = await import("../sessions/db");
        const modelCfgRaw = getSessionModelConfigJson(sessionId, dataDir);
        if (modelCfgRaw) {
          const modelCfg = JSON.parse(modelCfgRaw);
          const sessionEffort = modelCfg.models?.[model.modelName]?.thinkingEffort;
          if (sessionEffort !== undefined) resolvedThinkingEffort = sessionEffort;
        }
      } catch {}
    }
    if (resolvedThinkingEffort === runtime.thinkingEffort) {
      const globalPerModel = provider.models?.find(m => m.modelName === model.modelName);
      if (globalPerModel?.thinkingEffort !== undefined) resolvedThinkingEffort = globalPerModel.thinkingEffort;
    }

    // Snapshots
    const promptSnapshotId = ensurePromptSnapshot(systemBlock, dataDir);
    const fullTools = tools ? Object.entries(tools).map(([name, tool]) => ({
      type: "function" as const,
      function: { name, description: tool.description ?? "", parameters: tool.parameters ?? { type: "object", properties: {} } },
    })) : [];
    const debugTools = JSON.stringify(fullTools);
    let toolsSnapshotId: number | undefined;
    if (debugTools.length > 2) {
      toolsSnapshotId = ensureToolsSnapshot(debugTools, dataDir);
    }
    updateTurnSnapshots(traceTurnId, promptSnapshotId, toolsSnapshotId, dataDir);

    const tps = config.testModels?.[model.modelName]?.tokensPerSecond;
    const modelSpeed = tps && tps > 0 ? Math.round(1000 / tps) : 0;

    // ── Trace schema: step-scoped writer ───────────────────────────
    let currentStepId: number | null = null;
    let stepWriter = createStepStreamWriter(sessionId, traceTurnId, 0, dataDir);

    let _fullContent = "";
    let _parts: MessagePartType[] | undefined;
    let streamError: string | undefined;
    let streamRawError: string | undefined;
    let streamErrorIsCustom: boolean | undefined;
    let debugInfo: import("../../../_shared/types").TurnDebugInfo | undefined;
    let rawRequest: Record<string, unknown> | undefined;
    let rawResponse: Record<string, unknown> | undefined;
    let _streamResult: Awaited<ReturnType<typeof streamChat>> | undefined;
    try {
      const streamResult = await streamChat({
        provider, model: model.modelName, messages: modelMessages, tools,
        maxSteps: runtime.maxSteps, temperature: runtime.temperature,
        thinkingEffort: resolvedThinkingEffort,
        onRetryAttempt: () => {
          if (traceTurnId != null) {
            clearTurnSteps(traceTurnId, dataDir);
            partSeq = 0;
            stepWriter = createStepStreamWriter(sessionId, traceTurnId, 0, dataDir);
          }
        },
        onToken: (token) => {
          if (turnEnded) return;
          const seq = ++partSeq;
          events.onToken?.(token, seq);
          stepWriter.writeDelta("text", token, seq);
        },
        onReasoning: (delta) => {
          if (turnEnded) return;
          const seq = ++partSeq;
          events.onReasoning?.(delta, seq);
          stepWriter.writeDelta("reasoning", delta, seq);
        },
        onStepStart: (info) => {
          stepWriter.closeOpen();
          currentStepId = createStep(traceTurnId, sessionId, info.stepIndex, {
            providerName: provider.displayName,
            modelId: model.modelName,
            callId: `step-${info.stepIndex}-${traceTurnId}`,
            requestMetaJson: info.request ? JSON.stringify(info.request) : undefined,
            warningsJson: info.warnings ? JSON.stringify(info.warnings) : undefined,
          }, dataDir);
          stepWriter.rebindStep(currentStepId);
        },
        onStepFinish: (info) => {
          if (currentStepId != null) {
            stepWriter.closeOpen();
            // Persist full SDK finish-step meta (usage details, performance, provider metadata)
            finalizeStep(currentStepId, {
              finishReason: info.finishReason != null ? String(info.finishReason) : undefined,
              rawFinishReason: info.rawFinishReason,
              inputTokens: info.inputTokens,
              outputTokens: info.outputTokens,
              totalTokens: info.totalTokens,
              reasoningTokens: info.reasoningTokens,
              cacheReadTokens: info.cacheReadTokens,
              cacheWriteTokens: info.cacheWriteTokens,
              noCacheInputTokens: info.noCacheInputTokens,
              usageRawJson: info.usageRawJson,
              stepTimeMs: info.stepTimeMs,
              responseTimeMs: info.responseTimeMs,
              timeToFirstOutputMs: info.timeToFirstOutputMs,
              effectiveOutputTps: info.effectiveOutputTps,
              outputTps: info.outputTps,
              inputTps: info.inputTps,
              toolExecutionMsJson: info.toolExecutionMsJson,
              performanceJson: info.performanceJson,
              providerMetadataJson: info.providerMetadataJson,
              warningsJson: info.warningsJson,
              responseId: info.responseId,
              responseModelId: info.responseModelId,
            }, dataDir);
            currentStepId = null;
          }
        },
        onToolCall: (e) => {
          if (turnEnded) return;
          stepWriter.closeOpen();
          const seq = ++partSeq;
          stepWriter.setToolPart(e.toolCallId, e.toolName, e.args, seq);
          events.onToolCall?.({ ...e, seq });
        },
        onToolResult: (e) => {
          if (!turnEnded) {
            if (isStopTurnResult(e.output)) turnEnded = true;
            stepWriter.updateToolResult(e.toolCallId, e.output, e.isError);
            events.onToolResult?.(e);
          }
        },
        signal: abortSignal, hookCtx, modelSpeed, workspaceRoot,
        streamRetryErrorName: config.streamRetryErrorName,
        streamRetryMaxAttempts: config.streamRetryMaxAttempts,
      });
      _fullContent = streamResult.content;
      _parts = streamResult.parts;
      streamError = streamResult.error;
      streamRawError = streamResult.rawError;
      streamErrorIsCustom = streamResult.errorIsCustom;
      debugInfo = streamResult.debugInfo;
      rawRequest = streamResult.rawRequest;
      rawResponse = streamResult.rawResponse;
      _streamResult = streamResult;
    } finally {
      stepWriter.closeOpen();
      if (rawRequest !== undefined || rawResponse !== undefined) {
        updateTurnRawCapture(traceTurnId, rawRequest, rawResponse, dataDir);
      }
    }
    const streamResult = _streamResult!;

    let fullContent = _fullContent;
    let parts = _parts;

    if (parts) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type === "tool" && p.status === "completed" &&
            typeof p.result === "object" && p.result !== null && isStopTurnResult(p.result)) {
          parts = parts.slice(0, i + 1);
          break;
        }
      }
    }

    if (!fullContent && (!parts || parts.length === 0)) {
      const error = `Empty assistant response (no text, tool, or reasoning output) ` +
        `from ${provider.displayName} / ${model.displayName}. ` +
        `The model may not support tools, or it failed silently. ` +
        `Set Settings > Agents > Subagent to a tool-capable model.`;
      const rawEmpty = (rawResponse && JSON.stringify(rawResponse)) || "SDK returned no text, tool, or reasoning output";
      const errInfo: LlmErrorInfo = { message: error, raw: rawEmpty, isCustom: true, kind: "unknown" };
      finalizeTurnTrace(traceTurnId, { success: false, errorMessage: error, errorRaw: rawEmpty, errorIsCustom: true }, dataDir);
      await bus?.emit("turn.error", hookCtx, { sessionId, error, durationMs: Date.now() - turnStarted });
      unregisterSession(sessionId);
      return {
        sessionId, created, meta: session.meta, workspaceRoot, userMessage,
        assistantMessage: buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber }),
        error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
        modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
      };
    }

    if (streamError) {
      const raw = (streamRawError || streamError).trim();
      const msg = streamError.trim();
      const errInfo: LlmErrorInfo = { message: msg, raw, isCustom: streamErrorIsCustom === true && raw !== msg, kind: "unknown" };
      await bus?.emit("turn.error", hookCtx, { sessionId, error: errInfo.message, durationMs: Date.now() - turnStarted });
      finalizeTurnTrace(traceTurnId, { success: false, errorMessage: errInfo.message, errorRaw: errInfo.raw, errorIsCustom: errInfo.isCustom }, dataDir);
      unregisterSession(sessionId);
      return {
        sessionId, created, meta: session.meta, workspaceRoot, userMessage,
        assistantMessage: buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, priorContent: fullContent }),
        error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
        modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
      };
    }

    const assistantParts = parts && parts.length > 0 ? parts : undefined;
    let contentToStore = fullContent;

    const assistantMessage: Message = {
      role: "assistant",
      content: contentToStore || (assistantParts ? "(tool-only turn)" : ""),
      parts: assistantParts,
      timestamp: new Date().toISOString(), turnId: turnNumber,
    };

    await updateSessionTimestamp(dataDir, sessionId);

    // Trace finalize — prefer stream finish reason, else last step
    const lastStepFr = streamResult.steps?.[streamResult.steps.length - 1]?.finishReason;
    if (streamResult.finishReason === "aborted") {
      abortTurnTrace(traceTurnId, dataDir);
    } else {
      finalizeTurnTrace(traceTurnId, {
        success: true,
        finishReason: streamResult.finishReason ?? (lastStepFr != null ? String(lastStepFr) : "stop"),
      }, dataDir);
    }

    unregisterSession(sessionId);

    const updated = await getSession(dataDir, sessionId);
    const meta = updated?.meta ?? session.meta;
    const responseDurationMs = Date.now() - turnStarted;

    await bus?.emit("turn.complete", hookCtx, { sessionId, meta, workspaceRoot, userMessage, assistantMessage, durationMs: responseDurationMs });

    if (assistantMessage) {
      assistantMessage.modelName = model.displayName;
      assistantMessage.providerName = provider.displayName;
      assistantMessage.durationMs = responseDurationMs;
      assistantMessage.agentName = agentName || "Default (no system prompt)";
    }

    return {
      sessionId, created, meta, workspaceRoot, userMessage, assistantMessage,
      modelName: model.displayName, providerName: provider.displayName,
      durationMs: responseDurationMs, turnId: turnNumber, success: true,
    };
  } catch (err: unknown) {
    console.log("[runTurn] streamChat:exception", { sessionId, error: err instanceof Error ? err.message : String(err) });
    // Abort trace on exception
    abortTurnTrace(traceTurnId, dataDir);
    unregisterSession(sessionId);
    if (!isAbortError(err)) {
      const errInfo: LlmErrorInfo = err instanceof LlmError ? err.toInfo() : classifyLlmError(err, { provider: provider.displayName, model: model.displayName });
      await bus?.emit("turn.error", hookCtx, { sessionId, error: errInfo.message, durationMs: Date.now() - turnStarted });
      const errAssistantMsg = buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, turnId: turnNumber });
      let failedMeta = { id: sessionId, title: "", providerName: "", modelName: "", created: "", updated: "" };
      try { const failedSession = await getSession(dataDir, sessionId); if (failedSession?.meta) failedMeta = failedSession.meta; } catch {}
      return {
        sessionId, created, meta: failedMeta, workspaceRoot, userMessage,
        assistantMessage: errAssistantMsg,
        error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
        modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
      };
    }
    throw err;
  }
}
