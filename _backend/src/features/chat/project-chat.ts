import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns, turnContext, steps, stepParts, promptSnapshots, toolsSnapshots, sessions, summaryBlocks } from "../../db/schema";
import type { CoreMessage } from "ai";
import type { Message, MessagePartType } from "../../../../_shared/types";
import type { TurnSummary, StepSummary, TurnDetail, SessionUsage, TurnStatus, StepPart, TurnRawCapture, TurnStepRawDetail } from "../../../../_shared/types/trace";
import { listContextTurnIds } from "./db-trace";
import { buildModelMessages } from "./message-builder";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

// ── Chat projection: turns → Message[] ───────────────────────────────

export function projectSessionChat(sessionId: string, dataDir?: string): Message[] {
  const db = dbFor(dataDir);
  const turnRows = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.turnNumber)
    .all();

  if (turnRows.length === 0) return [];

  // Single batch fetch: all stepParts for all turns in one query
  const turnIds = turnRows.map((t) => t.id);
  const allParts = db
    .select()
    .from(stepParts)
    .where(inArray(stepParts.turnId, turnIds))
    .orderBy(stepParts.seq)
    .all();

  const partsByTurnId = new Map<number, typeof allParts>();
  for (const p of allParts) {
    const list = partsByTurnId.get(p.turnId);
    if (list) {
      list.push(p);
    } else {
      partsByTurnId.set(p.turnId, [p]);
    }
  }

  // Summary turns sit in the timeline at the circle position: immediately AFTER
  // the last covered real turn (block.endTurn) and BEFORE the next live turn.
  // Sort key is endTurn + 0.5 so they never sort as "last turn" via turnNumber.
  const blockBySummaryTurn = new Map<number, { endTurn: number; startTurn: number }>();
  const blocks = db
    .select({ summaryTurnId: summaryBlocks.summaryTurnId, endTurn: summaryBlocks.endTurn, startTurn: summaryBlocks.startTurn })
    .from(summaryBlocks)
    .where(eq(summaryBlocks.sessionId, sessionId))
    .all();
  for (const b of blocks) blockBySummaryTurn.set(b.summaryTurnId, b);

  type OrderEntry = {
    pos: number;
    isSummary: number;
    id: number;
    /** Display/context turn marker — for summaries this is endTurn (circle), not DB turnNumber */
    turnId: number;
    endTurn?: number;
    startTurn?: number;
  };
  const order: OrderEntry[] = [];
  for (const t of turnRows) {
    if ((t.kind ?? "turn") === "summary") {
      const blk = blockBySummaryTurn.get(t.id);
      const endTurn = blk?.endTurn ?? t.turnNumber;
      const startTurn = blk?.startTurn ?? endTurn;
      // Half-step after last covered turn ⇒ between covered range and live turns.
      order.push({
        pos: endTurn + 0.5,
        isSummary: 1,
        id: t.id,
        turnId: endTurn,
        endTurn,
        startTurn,
      });
    } else {
      order.push({ pos: t.turnNumber, isSummary: 0, id: t.id, turnId: t.turnNumber });
    }
  }
  order.sort((a, b) => a.pos - b.pos || a.isSummary - b.isSummary || a.id - b.id);

  const out: Message[] = [];
  for (const o of order) {
    const t = turnRows.find((x) => x.id === o.id);
    if (!t) continue;

    const parts = partsByTurnId.get(t.id) ?? [];

    const textParts = parts.filter((p) => p.type === "text");
    const text = textParts
      .map((p) => {
        try {
          const d = JSON.parse(p.data);
          return typeof d.content === "string" ? d.content : "";
        } catch {
          return "";
        }
      })
      .join("");

    const msgParts: MessagePartType[] = parts.map((p) => {
      try {
        const d = JSON.parse(p.data);
        return {
          ...d,
          type: p.type as MessagePartType["type"],
          status: p.status as any,
          _seq: p.seq,
          messageId: t.id * 2 + 1,
          // Column fields win — data blob historically dropped toolName on tool_end
          ...(p.toolCallId != null ? { toolCallId: p.toolCallId } : {}),
          ...(p.toolName != null ? { toolName: p.toolName } : {}),
          ...(p.parentToolCallId != null ? { parentToolCallId: p.parentToolCallId } : {}),
        };
      } catch {
        return {
          type: p.type as MessagePartType["type"],
          content: p.data,
          _seq: p.seq,
          ...(p.toolCallId != null ? { toolCallId: p.toolCallId } : {}),
          ...(p.toolName != null ? { toolName: p.toolName } : {}),
          ...(p.parentToolCallId != null ? { parentToolCallId: p.parentToolCallId } : {}),
        };
      }
    });

    // Summary turns: emit as a full turn pair (user + assistant) just like normal turns.
    // The user message contains the summarization prompt; the assistant contains the summary.
    if (o.isSummary) {
      // User message (the summarization prompt)
      out.push({
        id: t.id * 2,
        role: "user",
        content: t.userContent,
        timestamp: t.userTimestamp,
        turnId: o.turnId,
        agentName: t.agentName ?? undefined,
        isSummary: true,
        summaryEndTurn: o.endTurn,
        summaryStartTurn: o.startTurn,
      });

      // Assistant message (the summary result) with full metadata
      out.push({
        id: t.id * 2 + 1,
        role: "assistant",
        content: text || "(empty summary)",
        parts: msgParts.length > 0 ? msgParts : undefined,
        timestamp: t.completedAt ?? t.startedAt,
        turnId: o.turnId,
        success: t.success ?? undefined,
        status: t.status,
        modelName: t.modelName ?? undefined,
        providerName: t.providerName ?? undefined,
        durationMs: t.durationMs ?? undefined,
        agentName: t.agentName ?? undefined,
        isSummary: true,
        summaryEndTurn: o.endTurn,
        summaryStartTurn: o.startTurn,
      });
      continue;
    }

    out.push({
      id: t.id * 2,
      role: "user",
      content: t.userContent,
      timestamp: t.userTimestamp,
      turnId: o.turnId,
      agentName: t.agentName ?? undefined,
    });

    out.push({
      id: t.id * 2 + 1,
      role: "assistant",
      content: text || (parts.some((p) => p.type === "tool") ? "(tool-only turn)" : ""),
      parts: msgParts,
      timestamp: t.completedAt ?? t.startedAt,
      turnId: o.turnId,
      success: t.success ?? undefined,
      status: t.status,
      modelName: t.modelName ?? undefined,
      providerName: t.providerName ?? undefined,
      durationMs: t.durationMs ?? undefined,
      agentName: t.agentName ?? undefined,
      errorDetail: t.errorMessage
        ? { message: t.errorMessage, raw: t.errorRaw ?? undefined, isCustom: t.errorIsCustom ?? undefined }
        : undefined,
    });
  }
  return out;
}

export function projectStreamingContent(sessionId: string, dataDir?: string): string {
  const db = dbFor(dataDir);
  const openTurn = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.status, "streaming")))
    .get();
  if (!openTurn) return "";
  const textParts = db
    .select({ data: stepParts.data })
    .from(stepParts)
    .where(and(eq(stepParts.turnId, openTurn.id), eq(stepParts.type, "text")))
    .orderBy(stepParts.seq)
    .all();
  return textParts
    .map((p) => {
      try {
        const d = JSON.parse(p.data);
        return typeof d.content === "string" ? d.content : "";
      } catch {
        return "";
      }
    })
    .join("");
}

// ── Model history from context refs ───────────────────────────────────

export function resolveContextTurnIds(
  sessionId: string,
  dataDir?: string,
  opts?: { includeFailedTurns?: boolean; firstTurnNumber?: number | null },
): number[] {
  const db = dbFor(dataDir);
  const includeFailed = opts?.includeFailedTurns ?? true;

  // Query completed turns directly from turns table (no turnContext dependency)
  const whereClause = includeFailed
    ? eq(turns.sessionId, sessionId)
    : and(eq(turns.sessionId, sessionId), eq(turns.success, true));

  const rows = db
    .select({ id: turns.id, turnNumber: turns.turnNumber })
    .from(turns)
    .where(whereClause)
    .orderBy(turns.turnNumber)
    .all();

  let results = rows.map((r) => r.id);

  // Apply firstTurnNumber filter (null = all turns, current behavior)
  const firstTn = opts?.firstTurnNumber;
  if (firstTn != null && firstTn > 0) {
    const firstId = rows.find((r) => r.turnNumber >= firstTn)?.id;
    if (firstId != null) {
      const idx = results.indexOf(firstId);
      if (idx > 0) {
        results = results.slice(idx);
      }
    }
  }

  return results;
}

// ── Turn summary/detail projections ───────────────────────────────────

export function listTurnSummaries(sessionId: string, dataDir?: string): TurnSummary[] {
  const db = dbFor(dataDir);
  const rows = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.turnNumber)
    .all();
  return rows.map((t) => {
    const ctxRows = db
      .select({ turnNumber: turns.turnNumber })
      .from(turnContext)
      .innerJoin(turns, eq(turns.id, turnContext.contextTurnId))
      .where(eq(turnContext.turnId, t.id))
      .orderBy(turnContext.position)
      .all();
    return {
      turnNumber: t.turnNumber,
      status: t.status as TurnStatus,
      userContentPreview: t.userContent?.slice(0, 100),
      modelName: t.modelName ?? undefined,
      providerName: t.providerName ?? undefined,
      durationMs: t.durationMs ?? undefined,
      inputTokens: t.inputTokens ?? undefined,
      outputTokens: t.outputTokens ?? undefined,
      totalTokens: t.totalTokens ?? undefined,
      stepCount: t.stepCount ?? undefined,
      success: t.success ?? undefined,
      contextTurnNumbers: ctxRows.map((r) => r.turnNumber),
    };
  });
}

export function getTurnDetail(
  sessionId: string,
  turnNumber: number,
  dataDir?: string,
): TurnDetail | null {
  const db = dbFor(dataDir);
  const t = db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get();
  if (!t) return null;

  const ctxRows = db
    .select({ turnNumber: turns.turnNumber })
    .from(turnContext)
    .innerJoin(turns, eq(turns.id, turnContext.contextTurnId))
    .where(eq(turnContext.turnId, t.id))
    .orderBy(turnContext.position)
    .all();

  const stepRows = db
    .select()
    .from(steps)
    .where(eq(steps.turnId, t.id))
    .orderBy(steps.stepIndex)
    .all();

  const stepPartRows = db
    .select()
    .from(stepParts)
    .where(eq(stepParts.turnId, t.id))
    .orderBy(stepParts.seq)
    .all();

  let systemPrompt: string | undefined;
  if (t.systemPromptSnapshotId) {
    const sp = db
      .select({ content: promptSnapshots.content })
      .from(promptSnapshots)
      .where(eq(promptSnapshots.id, t.systemPromptSnapshotId))
      .get();
    if (sp) systemPrompt = sp.content;
  }

  let toolsList: TurnDetail["tools"];
  if (t.toolsSnapshotId) {
    const ts = db
      .select({ toolsJson: toolsSnapshots.toolsJson })
      .from(toolsSnapshots)
      .where(eq(toolsSnapshots.id, t.toolsSnapshotId))
      .get();
    if (ts?.toolsJson) {
      try {
        toolsList = JSON.parse(ts.toolsJson);
      } catch {}
    }
  }

  return {
    turnNumber: t.turnNumber,
    status: t.status as TurnStatus,
    userContent: t.userContent,
    userTimestamp: t.userTimestamp,
    agentName: t.agentName ?? undefined,
    systemPrompt,
    tools: toolsList,
    modelName: t.modelName ?? undefined,
    providerName: t.providerName ?? undefined,
    durationMs: t.durationMs ?? undefined,
    inputTokens: t.inputTokens ?? undefined,
    outputTokens: t.outputTokens ?? undefined,
    totalTokens: t.totalTokens ?? undefined,
    stepCount: t.stepCount ?? undefined,
    success: t.success ?? undefined,
    contextTurnNumbers: ctxRows.map((r) => r.turnNumber),
    steps: stepRows.map((s) => ({
      id: s.id,
      stepIndex: s.stepIndex,
      status: s.status,
      finishReason: s.finishReason ?? undefined,
      rawFinishReason: s.rawFinishReason ?? undefined,
      inputTokens: s.inputTokens ?? undefined,
      outputTokens: s.outputTokens ?? undefined,
      totalTokens: s.totalTokens ?? undefined,
      reasoningTokens: s.reasoningTokens ?? undefined,
      cacheReadTokens: s.cacheReadTokens ?? undefined,
      cacheWriteTokens: s.cacheWriteTokens ?? undefined,
      noCacheInputTokens: s.noCacheInputTokens ?? undefined,
      stepTimeMs: s.stepTimeMs ?? undefined,
      responseTimeMs: s.responseTimeMs ?? undefined,
      timeToFirstOutputMs: s.timeToFirstOutputMs ?? undefined,
      effectiveOutputTps: s.effectiveOutputTps ?? undefined,
      outputTps: s.outputTps ?? undefined,
      inputTps: s.inputTps ?? undefined,
      modelId: s.modelId ?? undefined,
      responseModelId: s.responseModelId ?? undefined,
      providerName: s.providerName ?? undefined,
      responseId: s.responseId ?? undefined,
    })),
    stepParts: stepPartRows.map((p) => {
      let data: Record<string, unknown> | undefined;
      if (p.data) {
        try {
          data = JSON.parse(p.data);
        } catch {
          data = undefined;
        }
      }
      return {
        id: p.id,
        stepId: p.stepId,
        type: p.type as StepPart["type"],
        seq: p.seq,
        toolCallId: p.toolCallId ?? undefined,
        toolName: p.toolName ?? undefined,
        parentToolCallId: p.parentToolCallId ?? undefined,
        data,
        status: p.status ?? undefined,
      } satisfies StepPart;
    }),
    errorMessage: t.errorMessage ?? undefined,
  };
}

export function getSessionUsage(sessionId: string, dataDir?: string): SessionUsage {
  const db = dbFor(dataDir);

  // Always derive reasoning from successful turns (not on session cache columns)
  const turnAgg = db
    .select({
      inputTokens: sum(turns.inputTokens),
      outputTokens: sum(turns.outputTokens),
      totalTokens: sum(turns.totalTokens),
      reasoningTokens: sum(turns.reasoningTokens),
      turnCount: sql`COUNT(*)`.as("turnCount"),
    })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.success, true)))
    .get();

  const stepCount = db
    .select({ count: count() })
    .from(steps)
    .where(eq(steps.sessionId, sessionId))
    .get();

  const s = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();

  // Prefer session cache for hot path totals when present; always use live reasoning SUM
  if (s && s.cachedInputTokens != null) {
    return {
      inputTokens: s.cachedInputTokens ?? 0,
      outputTokens: s.cachedOutputTokens ?? 0,
      totalTokens: s.cachedTotalTokens ?? 0,
      reasoningTokens: Number(turnAgg?.reasoningTokens ?? 0),
      turnCount: s.cachedTurnCount ?? 0,
      stepCount: Number(stepCount?.count ?? 0),
    };
  }

  return {
    inputTokens: Number(turnAgg?.inputTokens ?? 0),
    outputTokens: Number(turnAgg?.outputTokens ?? 0),
    totalTokens: Number(turnAgg?.totalTokens ?? 0),
    reasoningTokens: Number(turnAgg?.reasoningTokens ?? 0),
    turnCount: Number(turnAgg?.turnCount ?? 0),
    stepCount: Number(stepCount?.count ?? 0),
  };
}

export function getTurnRawCapture(
  turnId: number,
  dataDir?: string,
): { rawRequest: unknown; rawResponse: unknown } | null {
  const db = dbFor(dataDir);
  const t = db
    .select({ rawRequestJson: turns.rawRequestJson, rawResponseJson: turns.rawResponseJson })
    .from(turns)
    .where(eq(turns.id, turnId))
    .get();
  if (!t || (!t.rawRequestJson && !t.rawResponseJson)) return null;
  return {
    rawRequest: t.rawRequestJson ? JSON.parse(t.rawRequestJson) : null,
    rawResponse: t.rawResponseJson ? JSON.parse(t.rawResponseJson) : null,
  };
}

export function getTurnRawCaptureByNumber(
  sessionId: string,
  turnNumber: number,
  dataDir?: string,
): { rawRequest: unknown; rawResponse: unknown } | null {
  const db = dbFor(dataDir);
  const t = db
    .select({ rawRequestJson: turns.rawRequestJson, rawResponseJson: turns.rawResponseJson })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get();
  if (!t || (!t.rawRequestJson && !t.rawResponseJson)) return null;
  return {
    rawRequest: t.rawRequestJson ? JSON.parse(t.rawRequestJson) : null,
    rawResponse: t.rawResponseJson ? JSON.parse(t.rawResponseJson) : null,
  };
}

// ── Step-level projections ─────────────────────────────────────────────

export function getStepWithParts(
  sessionId: string,
  turnNumber: number,
  stepIndex: number,
  dataDir?: string,
): TurnDetail["steps"][number] & { parts: unknown[] } | null {
  const db = dbFor(dataDir);
  const t = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get();
  if (!t) return null;

  const s = db
    .select()
    .from(steps)
    .where(and(eq(steps.turnId, t.id), eq(steps.stepIndex, stepIndex)))
    .get();
  if (!s) return null;

  const parts = db
    .select()
    .from(stepParts)
    .where(eq(stepParts.stepId, s.id))
    .orderBy(stepParts.seq)
    .all();

  const parseJson = (raw: string | null): unknown | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  return {
    id: s.id,
    stepIndex: s.stepIndex,
    rawRequest: parseJson(s.rawRequestJson),
    rawResponse: parseJson(s.rawResponseJson),
    status: s.status,
    finishReason: s.finishReason ?? undefined,
    rawFinishReason: s.rawFinishReason ?? undefined,
    inputTokens: s.inputTokens ?? undefined,
    outputTokens: s.outputTokens ?? undefined,
    totalTokens: s.totalTokens ?? undefined,
    reasoningTokens: s.reasoningTokens ?? undefined,
    cacheReadTokens: s.cacheReadTokens ?? undefined,
    cacheWriteTokens: s.cacheWriteTokens ?? undefined,
    noCacheInputTokens: s.noCacheInputTokens ?? undefined,
    stepTimeMs: s.stepTimeMs ?? undefined,
    responseTimeMs: s.responseTimeMs ?? undefined,
    timeToFirstOutputMs: s.timeToFirstOutputMs ?? undefined,
    effectiveOutputTps: s.effectiveOutputTps ?? undefined,
    outputTps: s.outputTps ?? undefined,
    inputTps: s.inputTps ?? undefined,
    modelId: s.modelId ?? undefined,
    responseModelId: s.responseModelId ?? undefined,
    providerName: s.providerName ?? undefined,
    responseId: s.responseId ?? undefined,
    parts: parts.map((p) => {
      try {
        return {
          ...JSON.parse(p.data),
          type: p.type,
          status: p.status,
          _seq: p.seq,
          toolCallId: p.toolCallId ?? undefined,
          toolName: p.toolName ?? undefined,
          parentToolCallId: p.parentToolCallId ?? undefined,
        };
      }
      catch { return { type: p.type, content: p.data, _seq: p.seq }; }
    }),
  };
}

export function maxStepPartSeq(turnId: number, dataDir?: string): number {
  const db = dbFor(dataDir);
  const row = db
    .select({ maxSeq: stepParts.seq })
    .from(stepParts)
    .where(eq(stepParts.turnId, turnId))
    .orderBy(desc(stepParts.seq))
    .limit(1)
    .get();
  return row?.maxSeq ?? 0;
}

interface ReplayOptions {
  includeText: boolean;
  includeTools: boolean;
  includeReasoning: boolean;
  includePatch: boolean;
  includeOther: boolean;
}

function parsePartData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data);
  } catch {
    return { content: data };
  }
}

function replayStepPartsToMessages(
  parts: Array<{
    type: string;
    data: string;
    status: string | null;
    toolCallId: string | null;
    toolName: string | null;
  }>,
  opts: ReplayOptions,
): CoreMessage[] {
  const contentParts: NonNullable<CoreMessage["content"]> = [];
  const toolResultMessages: CoreMessage[] = [];

  for (const part of parts) {
    const data = parsePartData(part.data);
    switch (part.type) {
      case "text": {
        if (opts.includeText) {
          const text = typeof data.content === "string" ? data.content : "";
          if (text) contentParts.push({ type: "text", text });
        }
        break;
      }
      case "tool": {
        if (opts.includeTools && part.toolCallId) {
          const args = data.args ?? {};
          contentParts.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? "",
            input: args,
          });
          const rawOutput = data.result ?? data.output ?? "";
          toolResultMessages.push({
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName ?? "",
              output: part.status === "completed"
                ? { type: "text", value: typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) }
                : { type: "error-text", value: `Tool call ${part.status} before returning a result` },
            }],
          });
        }
        break;
      }
      case "reasoning": {
        if (opts.includeReasoning) {
          contentParts.push({ type: "reasoning", text: typeof data.content === "string" ? data.content : "" });
        }
        break;
      }
      case "patch": {
        if (opts.includePatch) {
          contentParts.push({ type: "text", text: typeof data.patch === "string" ? data.patch : JSON.stringify(data.patch) });
        }
        break;
      }
      default: {
        if (opts.includeOther) {
          const text = typeof data.content === "string" ? data.content : JSON.stringify(data);
          if (text) contentParts.push({ type: "text", text });
        }
        break;
      }
    }
  }

  const out: CoreMessage[] = [];
  if (contentParts.length > 0) out.push({ role: "assistant", content: contentParts });
  out.push(...toolResultMessages);
  return out;
}

/**
 * Reconstructs per-step raw inspection data for a turn.
 * Replays stepParts up to each step boundary with that step's prompt snapshot as instructions.
 * Returns turn-level raw + per-step detail array.
 */
export async function getTurnStepRawCapture(
  sessionId: string,
  turnNumber: number,
  dataDir?: string,
): Promise<TurnRawCapture | null> {
  const db = dbFor(dataDir);
  const t = db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get();
  if (!t) return null;

  // Turn-level raw fallback
  let turnRawRequest: unknown = null;
  let turnRawResponse: unknown = null;
  if (t.rawRequestJson) { try { turnRawRequest = JSON.parse(t.rawRequestJson); } catch {} }
  if (t.rawResponseJson) { try { turnRawResponse = JSON.parse(t.rawResponseJson); } catch {} }

  // Turn-level system prompt fallback
  let turnSystemPrompt: string | undefined;
  if (t.systemPromptSnapshotId) {
    const sp = db
      .select({ content: promptSnapshots.content })
      .from(promptSnapshots)
      .where(eq(promptSnapshots.id, t.systemPromptSnapshotId))
      .get();
    if (sp) turnSystemPrompt = sp.content;
  }

  // Steps for this turn
  const stepRows = db
    .select()
    .from(steps)
    .where(eq(steps.turnId, t.id))
    .orderBy(steps.stepIndex)
    .all();

  // Load step prompt snapshots + step parts
  const stepIds = stepRows.map(s => s.id);
  const stepPartsRows = stepIds.length
    ? db
        .select()
        .from(stepParts)
        .where(and(eq(stepParts.turnId, t.id), inArray(stepParts.stepId, stepIds)))
        .orderBy(stepParts.seq)
        .all()
    : [];

  const partsByStepId = new Map<number, typeof stepPartsRows>();
  for (const p of stepPartsRows) {
    const list = partsByStepId.get(p.stepId);
    if (list) list.push(p); else partsByStepId.set(p.stepId, [p]);
  }

  const snapIds = [...new Set(stepRows.map(s => s.promptSnapshotId).filter((v): v is number => v != null))];
  const snapMap = new Map<number, string>();
  if (snapIds.length) {
    const snaps = db
      .select({ id: promptSnapshots.id, content: promptSnapshots.content })
      .from(promptSnapshots)
      .where(inArray(promptSnapshots.id, snapIds))
      .all();
    for (const s of snaps) snapMap.set(s.id, s.content);
  }

  // Config snapshot for reconstruction flags
  interface ConfigSnap {
    includeFailedTurnsInHistory: boolean;
    includeToolCallsInHistory: boolean;
    includeReasoningInHistory: boolean;
    includePatchesInHistory: boolean;
    includeOtherPartsInHistory: boolean;
    contextMaxTurns?: number;
  }
  let configSnap: ConfigSnap | undefined;
  if (t.configSnapshotJson) { try { configSnap = JSON.parse(t.configSnapshotJson); } catch {} }

  // Base SDK messages: context turns + current user
  const ctxIds = listContextTurnIds(t.id, dataDir);
  let baseMessages: CoreMessage[] = [];
  let systemBlock = turnSystemPrompt ?? "";
  if (configSnap) {
    const built = await buildModelMessages(sessionId, systemBlock, {
      contextTurnIds: ctxIds,
      includeIncompleteTurns: configSnap.includeFailedTurnsInHistory,
      includeTextParts: true,
      includeTools: configSnap.includeToolCallsInHistory ?? true,
      includeReasoningParts: configSnap.includeReasoningInHistory ?? false,
      includePatchParts: configSnap.includePatchesInHistory ?? false,
      includeOtherParts: configSnap.includeOtherPartsInHistory ?? false,
      maxTurns: configSnap.contextMaxTurns,
      currentTurnNumber: turnNumber,
      currentUserMessage: t.userContent,
    }, dataDir);
    baseMessages = built.messages;
    systemBlock = built.systemBlock;
  } else {
    baseMessages = [{ role: "user", content: t.userContent }];
  }

  // Strip leading system message — instructions goes in `instructions` param, not messages array
  const systemMsg = baseMessages[0]?.role === "system" ? baseMessages[0].content : undefined;
  const sdkBase = systemMsg ? baseMessages.slice(1) : baseMessages;

  // Replay: accumulate per-step assistant + tool messages
  const stepsOut: TurnStepRawDetail[] = [];
  const accumulated: CoreMessage[] = [];
  for (const s of stepRows) {
    const stepSystemPrompt = s.promptSnapshotId != null
      ? (snapMap.get(s.promptSnapshotId) ?? turnSystemPrompt)
      : turnSystemPrompt;
    const instructions = stepSystemPrompt ?? systemMsg ?? "";
    const messages: CoreMessage[] = [
      ...sdkBase,
      ...accumulated,
    ];
    const sdkRequest: Record<string, unknown> = {
      model: t.modelName ?? "unknown",
      ...(instructions ? { instructions } : {}),
      messages,
      temperature: t.temperature ?? undefined,
      maxSteps: t.maxSteps ?? undefined,
    };
    // Verbatim per-step raw (fallback to turn-level)
    let providerRequest: Record<string, unknown> | null = null;
    let response: Record<string, unknown> | null = null;
    if (s.rawRequestJson) { try { providerRequest = JSON.parse(s.rawRequestJson); } catch {} }
    if (s.rawResponseJson) { try { response = JSON.parse(s.rawResponseJson); } catch {} }
    const hasPerStepRaw = !!(s.rawRequestJson || s.rawResponseJson);
    if (!providerRequest) providerRequest = turnRawRequest as Record<string, unknown> | null;
    if (!response) response = turnRawResponse as Record<string, unknown> | null;

    stepsOut.push({
      stepIndex: s.stepIndex,
      status: s.status,
      finishReason: s.finishReason ?? undefined,
      modelId: s.modelId ?? undefined,
      providerName: s.providerName ?? undefined,
      promptSnapshotId: s.promptSnapshotId ?? undefined,
      systemPrompt: stepSystemPrompt,
      sdkRequest,
      providerRequest,
      response,
      hasPerStepRaw,
    });

    // Accumulate this step's parts for next step
    const parts = partsByStepId.get(s.id) ?? [];
    accumulated.push(...replayStepPartsToMessages(parts, {
      includeText: true,
      includeTools: configSnap?.includeToolCallsInHistory ?? true,
      includeReasoning: configSnap?.includeReasoningInHistory ?? false,
      includePatch: configSnap?.includePatchesInHistory ?? false,
      includeOther: configSnap?.includeOtherPartsInHistory ?? false,
    }));
  }

  return { rawRequest: turnRawRequest, rawResponse: turnRawResponse, steps: stepsOut };
}
