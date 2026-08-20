import { join } from "node:path";
import type { ConfigFile, Message, MessagePartType, ThinkingEffort } from "../../../../../_shared/types";
import { effectiveFirstTurnFromAnchor, snapBoundaryToRanges } from "../../../../../_shared/types/context";
import { toJSONSchema } from "zod/v4";
import {
  createSession,
  getLiveSessionMeta,
  writeSessionSystemPrompt,
  updateSessionTimestamp,
  updateSessionWorkspace,
  updateSessionAgentName,
} from "../../sessions/store";
import { streamChat } from "../stream-llm";
import { classifyLlmError, LlmError, type LlmErrorInfo } from "../../../llm/errors";
import {
  createFolderRegistry,
  getWorkspaceRoot,
  toolsEnabled,
  isStopTurnResult,
  type ExtendedToolContext,
} from "../../tools";
import type { ResolveContext } from "../../tools/perms/resolve";
import { normalizeWorkspace } from "../../sessions/rest";
import { getMcpManager } from "../../mcp";
import {
  buildHookContext,
  withHookContext,
  getBus,
  type HookSource,
  type HookContext,
} from "../../hooks";
import { sendToSession } from "../../sessions/view-tracker";
import { resolveRuntimeFromSettings, getAgentSettings, resolveSessionRuntime, type ResolvedRuntime } from "../../agents/runtime-settings";
import { readAgent } from "../../agents/rest";
import { createPerStepSystemInfo } from "../per-step-system-prompt";
import { getMode } from "../../../paths";
import { getWorkspaceGraphManager } from "../../../core/workspaceGraph/service-singleton";
import type { WorkspaceGraphService } from "../../../core/workspaceGraph/api/types";
import { createStepStreamWriter } from "../persist-stream";
import { buildErrorAssistantMessage } from "../turn-errors";
import type { RetryEntry } from "../../../../../_shared/types";
import { createTpsTracker } from "../thinking-tps";
import {
  getNextTurnNumber,
  createTurn,
  insertTurnContext,
  ensurePromptSnapshot,
  ensureToolsSnapshot,
  updateTurnSnapshots,
  createStep,
  finalizeStep,
  insertStepPart,
  clearTurnSteps,
  finalizeTurnTrace,
  abortTurnTrace,
  updateTurnRawCapture,
  updateTurnConfigSnapshot,
  updateTurnPricing,
  writeStepRaw,
  persistRetryLogPart,
} from "../db-trace";
import { maybeAutoCompact } from "../auto-compaction";
import { getModelPricing } from "../../pricing/models-dev";
import { computeCostUsd } from "../../../../../_shared/types/config";
import { resolveContextTurnIds } from "../project-chat";
import { buildModelMessages } from "../message-builder";
import { buildSystemBlockBase, buildAdditionalSystemInfoBlock, buildAdditionalSystemInfoSections } from "../../system-prompt/builder";
import { DEFAULT_ADDITIONAL_SYSTEM_INFO, DEFAULT_SYSTEM_PROMPT_SECTIONS } from "../../../../../_shared/types/config";
import { getSessionModelConfigJson, getSummaryRangesForSession } from "../../sessions/db";
import {
  resolveRuntimeFirstTurnNumber,
  resolveRuntimeHistoryInclusion,
  type ContextScopeConfig,
  type ContextSource,
} from "../context-window";
import type { TurnCreateMeta, TurnInput, TurnEvents, TurnResult } from "../types";
import { generateId, autoTitle, isAbortError } from "./util";
import { inArray, and, eq, lte } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../../db/client";
import { turns, summaryRanges } from "../../../db/schema";
export { isAbortError } from "./util";
import { registerSession, unregisterSession } from "../../../session/runtime";
import { readFileSync } from "node:fs";

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
    const baseSettings: import("../../../../../_shared/types").AgentSettings = {
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
    const existing = await getLiveSessionMeta(dataDir, sessionId);
    if (!existing) throw new Error("Session not found");
    runtime = await resolveSessionRuntime(dataDir, existing, config);
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
    const existing = await getLiveSessionMeta(dataDir, sessionId);
    if (!existing) throw new Error("Session not found");
    if (!existing.workspaceRoot?.trim()) {
      const wsInput = input.workspaceRoot?.trim() || getWorkspaceRoot();
      const norm = normalizeWorkspace(wsInput);
      if ("error" in norm) throw new Error(norm.error);
      workspaceRoot = norm.path;
      await updateSessionWorkspace(dataDir, sessionId, workspaceRoot);
    } else {
      workspaceRoot = existing.workspaceRoot;
    }
    if (agentName !== undefined && agentName !== existing.agentName) {
      await updateSessionAgentName(dataDir, sessionId, agentName);
    }
  }

  // Pending auto-compaction: summarize + pin before this user message is persisted
  // so the new turn is not part of the summary. On failure AutoCompactionBlockedError
  // propagates (no catch here) → the send is blocked, no turn is created, and the
  // user message is not consumed, so the user can simply retry.
  if (!isNew) {
    await maybeAutoCompact(sessionId, dataDir ?? "", workspaceRoot ?? undefined);
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

  // ── Turn-start pricing fetch ──────────────────────────────────────
  let turnPricingSnapshot: Awaited<ReturnType<typeof getModelPricing>> | null = null;
  if (config.pricing?.enabled) {
    try {
      turnPricingSnapshot = await getModelPricing(provider, model.modelName, config, dataDir);
      const turnCostUsd = turnPricingSnapshot.found
        ? computeCostUsd({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          }, turnPricingSnapshot)
        : null;
      // Store pricing snapshot on turn (cost will be recomputed at finalize)
      updateTurnPricing(traceTurnId, JSON.stringify(turnPricingSnapshot), turnCostUsd, dataDir);
    } catch (err) {
      console.error("[pricing] turn-start fetch failed:", err);
      // Record found:false snapshot on error
      const errorSnapshot = {
        providerId: "",
        providerDisplayName: provider.displayName,
        modelId: model.modelName,
        found: false,
        sourceUrl: config.pricing?.sourceUrl ?? "https://models.dev/api.json",
        fetchedAt: new Date().toISOString(),
        rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
        error: err instanceof Error ? err.message : String(err),
      };
      updateTurnPricing(traceTurnId, JSON.stringify(errorSnapshot), null, dataDir);
    }
  }

  // ── Context refs ─────────────────────────────────────────────────

  // Resolve firstTurnNumber: WS wins; else session pin / auto; else project; else global.
  // Prior turns only (exclude the turn just created) so auto maxTurns matches UI semantics.
  let sessionCtx: ContextScopeConfig | null = null;
  let projectCtx: ContextScopeConfig | null = null;
  let globalCtx: ContextScopeConfig | null = null;
  try {
    const modelCfgRaw = getSessionModelConfigJson(sessionId, dataDir);
    if (modelCfgRaw) {
      const modelCfg = JSON.parse(modelCfgRaw);
      sessionCtx = (modelCfg?.context as ContextScopeConfig) ?? null;
    }
  } catch { /* ignore */ }
  try {
    const scopedRaw = readFileSync(join(dataDir, "context-config.json"), "utf-8");
    const scoped = JSON.parse(scopedRaw) as {
      global?: ContextScopeConfig;
      workspaces?: Record<string, ContextScopeConfig>;
    };
    globalCtx = scoped.global ?? null;
    if (workspaceRoot && scoped.workspaces?.[workspaceRoot]) {
      projectCtx = scoped.workspaces[workspaceRoot] ?? null;
    }
  } catch { /* ignore */ }

  // Effective auto-compaction threshold (session > project > global) — the "max"
  // denominator for the per-step context-token indicator.
  const scopeVal = (key: "autoCompactionEnabled" | "autoCompactionTriggerTokens" | "enabled") => {
    const sessionOn = sessionCtx?.enabled === true;
    const projectOn = projectCtx?.enabled === true;
    if (sessionOn && sessionCtx?.[key] !== undefined) return sessionCtx[key];
    if (projectOn && projectCtx?.[key] !== undefined) return projectCtx[key];
    if (globalCtx?.[key] !== undefined) return globalCtx[key];
    return undefined;
  };
  const autoCompactionOn = scopeVal("autoCompactionEnabled") === true;
  const autoCompactionThreshold = scopeVal("autoCompactionTriggerTokens") as number | undefined ?? 0;

  // Effective "History Included in Context" flags from the context scopes
  // (session > project > global), falling back to base chat-config values.
  // These only control what is re-sent from PREVIOUS turns; the current turn
  // always includes all part types.
  const historyFlags = resolveRuntimeHistoryInclusion({
    session: sessionCtx,
    project: projectCtx,
    global: globalCtx,
    defaults: {
      includeFailedTurnsInHistory: config.includeFailedTurnsInHistory ?? true,
      includeToolCallsInHistory: config.includeToolCallsInHistory ?? true,
      includeReasoningInHistory: config.includeReasoningInHistory ?? false,
      includePatchesInHistory: config.includePatchesInHistory ?? false,
      includeOtherPartsInHistory: config.includeOtherPartsInHistory ?? false,
    },
  });

  const dbForCtx = dataDir ? getDbForDataDir(dataDir) : getDb();
  const priorTurnRows = dbForCtx
    .select({ turnNumber: turns.turnNumber })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
    .all()
    .filter((r) => r.turnNumber < turnNumber);
  const completedTurnNumbers = priorTurnRows.map((r) => r.turnNumber);

  const resolvedCtx = resolveRuntimeFirstTurnNumber({
    wsFirstTurnNumber: input.contextFirstTurnNumber ?? null,
    session: sessionCtx,
    project: projectCtx,
    global: globalCtx,
    completedTurnNumbers,
  });
  const contextSource: ContextSource = resolvedCtx.source;

  // Summary-aware anchor normalization. An integer boundary that falls inside
  // a covered range snaps to the summary block (endTurn + 0.5) — the context
  // line can never start mid-summary. A summary anchor resolves to the first
  // live turn after the block. Mirrors the frontend via the shared helpers so
  // the displayed handle position and the effective context always agree.
  const ranges = getSummaryRangesForSession(dataDir, sessionId);
  const contextAnchor = snapBoundaryToRanges(resolvedCtx.firstTurnNumber, ranges);
  const firstTurnNumber = effectiveFirstTurnFromAnchor(contextAnchor);

  console.error("[run-turn] ctxFirstTurnNumber final:", firstTurnNumber, "source:", contextSource, "anchor:", contextAnchor);

  const contextTurnIds = resolveContextTurnIds(sessionId, dataDir, { includeFailedTurns: historyFlags.includeFailedTurnsInHistory, firstTurnNumber });

  await bus?.emit("message.user_persisted", hookCtx, { message: userMessage, sessionId });
  const session = await getLiveSessionMeta(dataDir, sessionId);
  if (!session) throw new Error("Session not found after create");
  events.onSessionReady?.({ sessionId, created, meta: session, turnId: turnNumber });
  // Emit turn_started for frontend streaming timeout tracking
  sendToSession(sessionId, { type: "turn_started", sessionId, turnId: turnNumber });
  await bus?.emit("turn.start", hookCtx, { sessionId, created, meta: session, workspaceRoot });

  const useTools = toolsEnabled();
  const mcpTools = getMcpManager().getTools();
  // Custom tools live in `data/tools/custom/<name>/` and are loaded by
  // createFolderRegistry → loadToolsFromFolders automatically (same as builtins).
  const registry = useTools
    ? await createFolderRegistry(dataDir, { exclude: input.excludeTools, extraTools: mcpTools }, config.agents)
    : null;

  const abortSignal = events.signal;
  let turnEnded = false;

  const bridgePermission = events.askPermission
    ? (toolName: string, args: unknown, callId: string) => events.askPermission!(toolName, args, callId)
    : undefined;

  const sessionAbortController = new AbortController();
  registerSession(sessionId, sessionAbortController, traceTurnId);

  /** Persist the turn's retry/error log as an "error" part (no-op when empty). */
  const persistRetries = (retries: RetryEntry[] | undefined) => {
    if (retries && retries.length > 0) persistRetryLogPart(sessionId, traceTurnId, retries, dataDir);
  };

  // Resolve workspace graph service for this session's workspaceRoot (lazy init if needed)
  let graphService: WorkspaceGraphService | undefined;
  if (config.workspaceGraph !== false) {
    const manager = getWorkspaceGraphManager();
    if (manager) {
      let gs = manager.get(workspaceRoot);
      if (!gs) {
        await manager.initializeForWorkspace(workspaceRoot, { enableWatcher: true });
        gs = manager.get(workspaceRoot);
      }
      graphService = gs ?? undefined;
    }
  }

  try {
    let partSeq = 0;
    // Thinking TPS tracker for the reasoning phase (2s window)
    const thinkingTpsTracker = createTpsTracker(2000);
    // Output TPS tracker for streamed text tokens (1s window — more responsive)
    const outputTpsTracker = createTpsTracker(1000);
    const resolveCtx: ResolveContext = { dataDir, sessionId, workspaceRoot, agentSettings: runtime.settings };
    const providerName = provider?.displayName;
    const modelName = model?.modelName;
    const tools = registry
      ? await registry.toFilteredAiSdkTools((callId) => ({
          sessionId, turnId: traceTurnId, workspaceRoot, dataDir,
          providerName, modelName,
          // Per-tool settings (timeouts, externalAccess, searchProviders,
          // subagent) now come from each tool's own `<name>.json` and are
          // injected by folderToToolDef — config.json's toolSettings is no
          // longer threaded here.
          skillRoots: [join(dataDir, "mds", "_skills")],
          abortSignal: abortSignal ?? new AbortController().signal,
          callId, hookCtx,
          graphService,
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
            ? async (req: Parameters<NonNullable<ExtendedToolContext["requestSubagentConfig"]>>[0]) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_config" });
                return events.requestSubagentConfig!(req);
              }
            : undefined,
          requestSlotBusyDecision: events.requestSlotBusyDecision
            ? async (req: Parameters<NonNullable<ExtendedToolContext["requestSlotBusyDecision"]>>[0]) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_config" });
                return events.requestSlotBusyDecision!(req);
              }
            : undefined,
          requestAgentChange: events.requestAgentChange
            ? async (req: Parameters<NonNullable<ExtendedToolContext["requestAgentChange"]>>[0]) => {
                events.onToolUpdate?.({ toolCallId: req.toolCallId || callId, status: "awaiting_agent_change" });
                return events.requestAgentChange!(req);
              }
            : undefined,
          abortTurn: events.abortTurn,
          onSlotWaitStart: events.onSlotWaitStart,
          onSlotWaitStatus: events.onSlotWaitStatus,
          onSlotWaitEnd: events.onSlotWaitEnd,
          agentSettings: runtime.settings,
        }), resolveCtx, config.toolExecutionMode)
      : undefined;

    const noSystemPrompt = input.noSystemPrompt ?? false;
    const turnStartNow = new Date();
    // Base is the real `system` message, rebuilt ONCE per turn (never per sub-step).
    // It includes `skills` (skill-attachment-modes) — per-turn freshness, stable within the turn.
    const systemBlock = await buildSystemBlockBase({
      dataDir, workspaceRoot, mode: getMode(), sessionId,
      agentSettings: runtime.settings, noSystemPrompt,
      systemPromptJoiners: config.systemPromptJoiners,
      systemPromptSections: runtime.settings.systemPromptSections,
      workspaceManifest: config.workspaceGraph !== false ? runtime.settings.workspaceManifest : undefined,
      graphService,
      now: turnStartNow,
      turnStart: turnStartNow,
    });

    const asiCfg = runtime.settings.additionalSystemInfo ?? config.additionalSystemInfo ?? DEFAULT_ADDITIONAL_SYSTEM_INFO;
    const additionalSystemInfoSections = asiCfg?.sections ?? ["runtime", "todoList", "workspaceManifest"];
    const additionalSystemInfoIncludeTime = asiCfg?.includeTime === true;
    const additionalSystemInfoAlways = asiCfg?.always === true;

    // Canonical ASI block for the sections baked into the base system prompt —
    // the emit-on-change baseline when no prior injection part exists yet.
    const sysSec = runtime.settings.systemPromptSections ?? DEFAULT_SYSTEM_PROMPT_SECTIONS;
    const sysSections: string[] = [];
    if (sysSec.runtime) sysSections.push("runtime");
    if (sysSec.todoList) sysSections.push("todoList");
    if (sysSec.workspaceManifest) sysSections.push("workspaceManifest");
    const systemAsiBaseline = await buildAdditionalSystemInfoBlock({
      dataDir, workspaceRoot, mode: getMode(), sessionId,
      noSystemPrompt,
      agentSettings: runtime.settings,
      systemPromptJoiners: config.systemPromptJoiners,
      workspaceManifest: config.workspaceGraph !== false ? runtime.settings.workspaceManifest : undefined,
      graphService,
      now: turnStartNow,
      turnStart: turnStartNow,
    }, sysSections, false);
    // Per-section content of the system-baked sections: the section-aware
    // emit-on-change reference for baked volatile sections (spec
    // asi-section-aware-emit). A volatile section equal to its system copy is
    // unchanged; a section absent here is treated as non-baked.
    const systemSections = await buildAdditionalSystemInfoSections({
      dataDir, workspaceRoot, mode: getMode(), sessionId,
      noSystemPrompt,
      agentSettings: runtime.settings,
      systemPromptJoiners: config.systemPromptJoiners,
      workspaceManifest: config.workspaceGraph !== false ? runtime.settings.workspaceManifest : undefined,
      graphService,
      now: turnStartNow,
      turnStart: turnStartNow,
    }, sysSections, false);

    // Build model messages (UNIFIED - includes system, history, current user)
    const { messages, contextTurnIds: usedTurnIds } = await buildModelMessages(
      sessionId,
      systemBlock,
      {
        contextTurnIds,
        includeIncompleteTurns: historyFlags.includeFailedTurnsInHistory,
        includeTextParts: true,
        includeTools: historyFlags.includeToolCallsInHistory,
        includeReasoningParts: historyFlags.includeReasoningInHistory,
        includePatchParts: historyFlags.includePatchesInHistory,
        includeOtherParts: historyFlags.includeOtherPartsInHistory,
        // maxTurns removed: slider auto mode computes firstTurnNumber as primary filter
        // Second maxTurns slice was redundant and could conflict with slider position
        currentTurnNumber: turnNumber,
        firstTurnNumber,
        currentUserMessage: input.content,
      },
      dataDir,
    );

    // Store which turns were actually used (audit trail)
    insertTurnContext(traceTurnId, usedTurnIds, dataDir);

    // Fix E: Structured context logging per turn (source from resolveRuntimeFirstTurnNumber)
    // Get turn numbers for logging
    let contextTurnNumbers: number[] = [];
    if (usedTurnIds.length > 0) {
      const db = dataDir ? getDbForDataDir(dataDir) : getDb();
      const turnRows = db
        .select({ turnNumber: turns.turnNumber })
        .from(turns)
        .where(inArray(turns.id, usedTurnIds))
        .all();
      contextTurnNumbers = turnRows.map(r => r.turnNumber).sort((a, b) => a - b);
    }

// Get summary range ID if any
    let summaryRangeId: number | null = null;
    if (firstTurnNumber != null) {
      const db = dataDir ? getDbForDataDir(dataDir) : getDb();
      const sliderTurn = firstTurnNumber != null ? firstTurnNumber : turnNumber;
      const range = db
        .select({ id: summaryRanges.id })
        .from(summaryRanges)
        .where(and(eq(summaryRanges.sessionId, sessionId), lte(summaryRanges.endTurn, sliderTurn)))
        .orderBy(summaryRanges.endTurn)
        .limit(1)
        .get();
      summaryRangeId = range?.id ?? null;
    }

    console.error("[context] session=" + sessionId + " turn=" + turnNumber +
      " firstTurnNumber=" + (firstTurnNumber ?? "null") +
      " source=" + contextSource +
      " contextTurnNumbers=" + JSON.stringify(contextTurnNumbers) +
      " summaryRange=" + (summaryRangeId ?? "none") +
      " inputTokens=" + "pending"); // Tokens not known yet at this stage

    await writeSessionSystemPrompt(dataDir, sessionId, systemBlock);

    let resolvedThinkingEffort = runtime.thinkingEffort;
    if (sessionId) {
      try {
        const { getSessionModelConfigJson } = await import("../../sessions/db");
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
    const fullTools = tools ? Object.entries(tools).map(async ([name, tool]) => {
      let parameters: unknown = { type: "object", properties: {} };
      if (tool.inputSchema != null) {
        try {
          parameters = toJSONSchema(tool.inputSchema as unknown as Parameters<typeof toJSONSchema>[0]);
        } catch {
          parameters = { type: "object", properties: {} };
        }
      }
      return {
        type: "function" as const,
        function: { name, description: tool.description ?? "", parameters },
      };
    }) : [];
    const resolvedTools = await Promise.all(fullTools);
    const debugTools = JSON.stringify(resolvedTools);
    let toolsSnapshotId: number | undefined;
    if (debugTools.length > 2) {
      toolsSnapshotId = ensureToolsSnapshot(debugTools, dataDir);
    }
    updateTurnSnapshots(traceTurnId, promptSnapshotId, toolsSnapshotId, dataDir);

    // Store config snapshot for reconstruction
    updateTurnConfigSnapshot(traceTurnId, {
      includeFailedTurnsInHistory: historyFlags.includeFailedTurnsInHistory,
      includeToolCallsInHistory: historyFlags.includeToolCallsInHistory,
      includeReasoningInHistory: historyFlags.includeReasoningInHistory,
      includePatchesInHistory: historyFlags.includePatchesInHistory,
      includeOtherPartsInHistory: historyFlags.includeOtherPartsInHistory,
      firstTurnNumber: contextAnchor,
      promptSnapshotId,
      toolsSnapshotId,
    }, dataDir);

    const tps = config.testModels?.[model.modelName]?.tokensPerSecond;
    const modelSpeed = tps && tps > 0 ? Math.round(1000 / tps) : 0;

    // Trace schema: step-scoped writer ───────────────────────────
    let currentStepId: number | null = null;
    let stepWriter = createStepStreamWriter(sessionId, traceTurnId, 0, dataDir);
    let stepIdByIndex: Record<number, number> = {};

    // Step-start pricing promise storage (for non-blocking fetch)
    let stepPricingPromise: Promise<Awaited<ReturnType<typeof getModelPricing>>> | null = null;

    // Per-step system info. The ASI is BUILT+COMPARED+EMITTED at the END of each
    // step (after its tools ran), so it reflects the changes that step caused and
    // is attributed to that step (spec §5/§6.1). prepareStep merely CARRIES the
    // pending injection from the previous step's end into the outgoing request.
    let lastPreparedBlock = systemBlock;
    const perStepCtx: import("../per-step-system-prompt").PerStepRebuildContext = {
      dataDir, workspaceRoot, sessionId, mode: getMode(),
      noSystemPrompt,
      agentSettings: runtime.settings,
      systemPromptJoiners: config.systemPromptJoiners,
      workspaceManifest: config.workspaceGraph !== false ? runtime.settings.workspaceManifest : undefined,
      graphService,
      additionalSystemInfoSections,
      additionalSystemInfoIncludeTime,
      additionalSystemInfoAlways,
      systemAsiBaseline,
      systemSections,
      turnStartNow,
      onBlockBuilt: (_stepNumber, block) => {
        // Per-step snapshot = base (+ injection) as a display proxy for the Inspector.
        lastPreparedBlock = systemBlock && block ? `${systemBlock}\n\n${block}` : (systemBlock || block);
      },
      persist: ({ toolCallId, toolName, content, stepIndex }) => {
        if (currentStepId == null) return;
        const seq = ++partSeq;
        insertStepPart(
          sessionId, traceTurnId, currentStepId, "tool",
          { content, kind: "system-info", additionalSystemInfo: true, stepIndex },
          seq, "completed",
          { toolCallId, toolName },
          dataDir,
        );
        // Surface the injection live (it is never streamed back by the model) so
        // the UI renders it as a distinct bubble after this step's tools.
        events.onToolCall?.({ toolCallId, toolName, args: {}, stepIndex, seq });
        events.onToolResult?.({ toolCallId, toolName, output: content, isError: false, seq });
      },
    };
    const perStep = createPerStepSystemInfo(perStepCtx);
    const prepareStep = perStep.prepareStep;

    let _fullContent = "";
    let _parts: MessagePartType[] | undefined;
    let streamError: string | undefined;
    let streamRawError: string | undefined;
    let streamErrorIsCustom: boolean | undefined;
    let debugInfo: import("../../../../../_shared/types").TurnDebugInfo | undefined;
    let rawRequest: Record<string, unknown> | undefined;
    let rawResponse: Record<string, unknown> | undefined;
    let _streamResult: Awaited<ReturnType<typeof streamChat>> | undefined;
    try {
      const streamResult = await streamChat({
        provider, model: model.modelName, messages, tools,
        sessionId,
        ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
        maxSteps: runtime.maxSteps, temperature: runtime.temperature,
        thinkingEffort: resolvedThinkingEffort,
        providerRouting: model.providerOrder
          ? { order: model.providerOrder, allowFallbacks: model.allowProviderFallbacks ?? true }
          : undefined,
        turnId: traceTurnId,
        onRetryAttempt: () => {
          if (traceTurnId != null) {
            clearTurnSteps(traceTurnId, dataDir);
            // NOTE: partSeq intentionally NOT reset — the frontend lastSeq keeps
            // climbing during the live turn, so seq must stay monotonic across
            // retries or post-retry tokens/events get dropped by the seq guard.
            stepWriter.close(); // release the previous writer's debounce timer/Maps
            stepWriter = createStepStreamWriter(sessionId, traceTurnId, 0, dataDir);
            stepIdByIndex = {};
            perStepCtx.pendingInjection = null;
            perStepCtx.lastEmittedSections = systemSections;
            lastPreparedBlock = systemBlock;
          }
        },
        onRetryError: (entry) => {
          const seq = ++partSeq;
          events.onRetryError?.({ entry, seq });
        },
        onToken: (token) => {
          if (turnEnded) return;
          // End thinking phase on first text delta
          if (thinkingTpsTracker.isActive()) {
            thinkingTpsTracker.end(Date.now());
            events.onThinkingEnd?.();
          }
          const seq = ++partSeq;
          // Track output TPS (live under-bubble badge)
          let tps: number | undefined;
          if (!outputTpsTracker.isActive()) {
            outputTpsTracker.start(token);
          } else {
            tps = outputTpsTracker.add(token, Date.now());
          }
          events.onToken?.(token, seq, tps);
          stepWriter.writeDelta("text", token, seq);
        },
        onReasoning: (delta) => {
          if (turnEnded) return;
          const seq = ++partSeq;
          // Track thinking TPS
          let tps: number | undefined;
          if (!thinkingTpsTracker.isActive()) {
            thinkingTpsTracker.start(delta);
          } else {
            tps = thinkingTpsTracker.add(delta, Date.now());
          }
          events.onReasoning?.(delta, seq, tps);
          stepWriter.writeDelta("reasoning", delta, seq);
        },
        onStepStart: (info) => {
          stepWriter.closeOpen();
          // Display proxy for the Inspector: the block reflects the injection
          // emitted at the PREVIOUS step's end (carried into this step's request).
          const stepPromptSnapshotId = ensurePromptSnapshot(lastPreparedBlock, dataDir);

          // Step-start pricing fetch (non-blocking)
          if (config.pricing?.enabled) {
            stepPricingPromise = getModelPricing(provider, model.modelName, config, dataDir).catch((err) => {
              console.error("[pricing] step-start fetch failed:", err);
              return {
                providerId: "",
                providerDisplayName: provider.displayName,
                modelId: model.modelName,
                found: false,
                sourceUrl: config.pricing?.sourceUrl ?? "https://models.dev/api.json",
                fetchedAt: new Date().toISOString(),
                rates: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
                error: err instanceof Error ? err.message : String(err),
              };
            });
          }

          currentStepId = createStep(traceTurnId, sessionId, info.stepIndex, {
            providerName: provider.displayName,
            modelId: model.modelName,
            callId: `step-${info.stepIndex}-${traceTurnId}`,
            requestMetaJson: info.request ? JSON.stringify(info.request) : undefined,
            warningsJson: info.warnings ? JSON.stringify(info.warnings) : undefined,
            promptSnapshotId: stepPromptSnapshotId,
          }, dataDir);
          stepIdByIndex[info.stepIndex] = currentStepId;
          stepWriter.rebindStep(currentStepId);
        },
onStepFinish: async (info) => {
          if (currentStepId != null) {
            // Build+compare+emit the ASI at the END of EVERY step (after its tools
            // executed). The injection reflects THIS step's changes and is persisted
            // against THIS step (attributed to the part that caused it), then carried
            // into the next step's request by prepareStep. Emit-on-change decides
            // whether an injection fires; there is no final-step gating (spec §6.1).
            try {
              await perStep.emitAtStepEnd(info.stepIndex);
            } catch (err) {
              console.error("[asi] emitAtStepEnd failed", err);
            }
            stepWriter.closeOpen();

            // End thinking phase on step finish (covers reasoning-only steps)
            if (thinkingTpsTracker.isActive()) {
              thinkingTpsTracker.end(Date.now());
              events.onThinkingEnd?.();
            }

            // Step pricing: await the promise (with 2s cap) if step-start refresh is on
            let stepPricingSnapshot: Awaited<ReturnType<typeof getModelPricing>> | null = null;
            let stepCostUsd: number | null = null;
            if (stepPricingPromise) {
              try {
                // Race the pricing fetch against a 2s timeout
                stepPricingSnapshot = await Promise.race([
                  stepPricingPromise,
                  new Promise<Awaited<ReturnType<typeof getModelPricing>>>((_, reject) =>
                    setTimeout(() => reject(new Error("pricing fetch timeout")), 2000)
                  ),
                ]);
                stepPricingPromise = null;
              } catch (err) {
                console.error("[pricing] step-start fetch timeout/error:", err);
                stepPricingPromise = null;
              }
            }

            // If no step pricing (enabled off or timed out), fall back to turn snapshot
            const pricingSnapshot = stepPricingSnapshot ?? turnPricingSnapshot;
            if (pricingSnapshot?.found) {
              stepCostUsd = computeCostUsd({
                inputTokens: info.inputTokens,
                outputTokens: info.outputTokens,
                cacheReadTokens: info.cacheReadTokens,
                cacheWriteTokens: info.cacheWriteTokens,
                noCacheInputTokens: info.noCacheInputTokens,
                reasoningTokens: info.reasoningTokens,
              }, pricingSnapshot);
            }

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
              responseId: info.responseId ?? undefined,
              responseModelId: info.responseModelId ?? undefined,
              pricingJson: pricingSnapshot ? JSON.stringify(pricingSnapshot) : undefined,
              costUsd: stepCostUsd ?? undefined,
            }, dataDir);
            // Emit after the step is persisted so live stats (usage tree) can refresh per step.
            // When auto compaction is on, also surface the step's context size so
            // the UI can show progress toward the compaction threshold per provider
            // step return. Context size = the step's input token count (which
            // already includes the cached portion); never add cacheReadTokens,
            // which is a sub-slice and would double-count the cached context.
            const stepUsed = info.inputTokens ?? 0;
            const stepContextTokens = autoCompactionOn && autoCompactionThreshold > 0
              ? { used: stepUsed, max: autoCompactionThreshold, pending: stepUsed >= autoCompactionThreshold }
              : undefined;
            await events.onStepEnd?.({ stepIndex: info.stepIndex, contextTokens: stepContextTokens });
            currentStepId = null;
          }
        },        onToolCall: (e) => {
          if (turnEnded) return;
          // End thinking phase on first tool call
          if (thinkingTpsTracker.isActive()) {
            thinkingTpsTracker.end(Date.now());
            events.onThinkingEnd?.();
          }
          stepWriter.closeOpen();
          const seq = ++partSeq;
          stepWriter.setToolPart(e.toolCallId, e.toolName, e.args, seq, e.stepIndex);
          events.onToolCall?.({ ...e, seq });
        },
        onToolResult: (e) => {
          if (!turnEnded) {
            if (isStopTurnResult(e.output)) turnEnded = true;
            stepWriter.updateToolResult(e.toolCallId, e.output, e.isError);
            events.onToolResult?.(e);
          }
        },
        onToolBatchStart: (e) => events.onToolBatchStart?.(e),
        onToolBatchEnd: (e) => events.onToolBatchEnd?.(e),
        signal: abortSignal, hookCtx, modelSpeed, workspaceRoot,
        streamRetryErrorName: config.streamRetryErrorName,
        streamRetryMaxAttempts: config.streamRetryMaxAttempts,
        streamRetryEnabled: config.streamRetryEnabled,
        streamRetryWindowValue: config.streamRetryWindowValue,
        streamRetryWindowUnit: config.streamRetryWindowUnit,
        streamRetryBaseDelayMs: config.streamRetryBaseDelayMs,
        streamRetryProgressiveDelayMs: config.streamRetryProgressiveDelayMs,
        prepareStep,
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
      stepWriter.close();
      if (rawRequest !== undefined || rawResponse !== undefined) {
        updateTurnRawCapture(traceTurnId, rawRequest, rawResponse, dataDir);
      }
      // Persist per-step verbatim raw exchanges captured during streaming
      const streamSteps = _streamResult?.steps;
      if (streamSteps) {
        for (const s of streamSteps) {
          if (s.rawRequest === undefined && s.rawResponse === undefined) continue;
          const stepId = stepIdByIndex[s.stepIndex];
          if (stepId != null) {
            writeStepRaw(stepId, s.rawRequest, s.rawResponse, dataDir);
          }
        }
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
      persistRetries(streamResult.retries);
      finalizeTurnTrace(traceTurnId, { success: false, errorMessage: error, errorRaw: rawEmpty, errorIsCustom: true }, dataDir, streamResult.steps);
      await bus?.emit("turn.error", hookCtx, { sessionId, error, durationMs: Date.now() - turnStarted });
      unregisterSession(sessionId);
      return {
        sessionId, created, meta: session, workspaceRoot, userMessage,
        assistantMessage: buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber }),
        error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
        modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
        retries: streamResult.retries,
      };
    }

    if (streamError) {
      const raw = (streamRawError || streamError).trim();
      const msg = streamError.trim();
      const errInfo: LlmErrorInfo = { message: msg, raw, isCustom: streamErrorIsCustom === true && raw !== msg, kind: "unknown" };
      await bus?.emit("turn.error", hookCtx, { sessionId, error: errInfo.message, durationMs: Date.now() - turnStarted });
      persistRetries(streamResult.retries);
      finalizeTurnTrace(traceTurnId, { success: false, errorMessage: errInfo.message, errorRaw: errInfo.raw, errorIsCustom: errInfo.isCustom }, dataDir, streamResult.steps);
      unregisterSession(sessionId);
      return {
        sessionId, created, meta: session, workspaceRoot, userMessage,
        assistantMessage: buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, priorContent: fullContent }),
        error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
        modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
        retries: streamResult.retries,
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
      abortTurnTrace(traceTurnId, dataDir, {
        errorMessage: streamResult.error,
        errorRaw: streamResult.rawError,
        errorIsCustom: streamResult.errorIsCustom,
      });
      persistRetries((streamResult.retries ?? []).map((r) =>
        r.status === "pending" ? { ...r, status: "aborted" as const } : r
      ));
    } else {
      persistRetries(streamResult.retries);
      finalizeTurnTrace(traceTurnId, {
        success: true,
        finishReason: streamResult.finishReason ?? (lastStepFr != null ? String(lastStepFr) : "stop"),
      }, dataDir, streamResult.steps);
    }

    unregisterSession(sessionId);

    const updated = await getLiveSessionMeta(dataDir, sessionId);
    const meta = updated ?? session;
    const responseDurationMs = Date.now() - turnStarted;

    await bus?.emit("turn.complete", hookCtx, { sessionId, meta, workspaceRoot, userMessage, assistantMessage, durationMs: responseDurationMs });

    if (assistantMessage) {
      assistantMessage.modelName = model.displayName;
      assistantMessage.providerName = provider.displayName;
      assistantMessage.durationMs = responseDurationMs;
      assistantMessage.agentName = agentName || undefined;
    }

    return {
      sessionId, created, meta, workspaceRoot, userMessage, assistantMessage,
      agentName: agentName || undefined,
      modelName: model.displayName, providerName: provider.displayName,
      durationMs: responseDurationMs, turnId: turnNumber, success: true,
    };
  } catch (err: unknown) {
    console.log("[runTurn] streamChat:exception", { sessionId, error: err instanceof Error ? err.message : String(err) });
    if (isAbortError(err)) {
      // Signal-aborted turn (user stop or SDK abort) — persist as "aborted",
      // preserving whatever error context the SDK surfaced.
      const abortErrInfo = classifyLlmError(err, { provider: provider.displayName, model: model.displayName });
      abortTurnTrace(traceTurnId, dataDir, { errorMessage: abortErrInfo.message, errorRaw: abortErrInfo.raw, errorIsCustom: abortErrInfo.isCustom });
      unregisterSession(sessionId);
      throw err;
    }

    // Genuine provider/model error thrown mid-stream — persist as an "error" turn so the
    // actual message survives a reload. (Previously mis-labeled "aborted" with a null
    // errorMessage, which hid the OpenRouter/provider 400 details after refresh.)
    const errInfo: LlmErrorInfo = err instanceof LlmError ? err.toInfo() : classifyLlmError(err, { provider: provider.displayName, model: model.displayName });
    const errRetries = err instanceof LlmError ? err.retries : undefined;
    persistRetries(errRetries);
    finalizeTurnTrace(traceTurnId, { success: false, errorMessage: errInfo.message, errorRaw: errInfo.raw, errorIsCustom: errInfo.isCustom }, dataDir);
    unregisterSession(sessionId);
    await bus?.emit("turn.error", hookCtx, { sessionId, error: errInfo.message, durationMs: Date.now() - turnStarted });
    const errAssistantMsg = buildErrorAssistantMessage(errInfo, { modelName: model.displayName, providerName: provider.displayName, turnId: turnNumber });
    let failedMeta = { id: sessionId, title: "", providerName: "", modelName: "", created: "", updated: "" };
    try { const failedMetaRow = await getLiveSessionMeta(dataDir, sessionId); if (failedMetaRow) failedMeta = failedMetaRow; } catch {}
    return {
      sessionId, created, meta: failedMeta, workspaceRoot, userMessage,
      assistantMessage: errAssistantMsg,
      error: errInfo.message, rawError: errInfo.raw, errorIsCustom: errInfo.isCustom,
      modelName: model.displayName, providerName: provider.displayName, durationMs: Date.now() - turnStarted, turnId: turnNumber, success: false,
      retries: errRetries,
    };
  }
}
