import { eq, and, desc } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns, turnContext, steps, stepParts, promptSnapshots, toolsSnapshots, sessions } from "../../db/schema";
import type { Message, MessagePartType } from "../../../../_shared/types";
import type { TurnSummary, StepSummary, TurnDetail, SessionUsage, TurnStatus, StepPart } from "../../../../_shared/types/trace";

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

  const out: Message[] = [];
  for (const t of turnRows) {
    out.push({
      id: t.id * 2,
      role: "user",
      content: t.userContent,
      timestamp: t.userTimestamp,
      turnId: t.turnNumber,
      agentName: t.agentName ?? undefined,
    });

    const parts = db
      .select()
      .from(stepParts)
      .where(eq(stepParts.turnId, t.id))
      .orderBy(stepParts.seq)
      .all();

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
        };
      } catch {
        return { type: p.type as MessagePartType["type"], content: p.data, _seq: p.seq };
      }
    });

    out.push({
      id: t.id * 2 + 1,
      role: "assistant",
      content: text || (parts.some((p) => p.type === "tool") ? "(tool-only turn)" : ""),
      parts: msgParts,
      timestamp: t.completedAt ?? t.startedAt,
      turnId: t.turnNumber,
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

export function resolveContextTurnIds(sessionId: string, dataDir?: string): number[] {
  // Default: all successful prior turns
  const db = dbFor(dataDir);
  const rows = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.success, true)))
    .orderBy(turns.turnNumber)
    .all();
  return rows.map((r) => r.id);
}

export function buildModelMessagesFromContext(
  contextTurnIds: number[],
  systemBlock: string,
  dataDir?: string,
): Message[] {
  const db = dbFor(dataDir);
  const history: Message[] = [];
  for (const ctxId of contextTurnIds) {
    const t = db
      .select()
      .from(turns)
      .where(eq(turns.id, ctxId))
      .get();
    if (!t) continue;

    history.push({
      role: "user",
      content: t.userContent,
      timestamp: t.userTimestamp,
      turnId: t.turnNumber,
    });

    const textParts = db
      .select({ data: stepParts.data })
      .from(stepParts)
      .where(and(eq(stepParts.turnId, ctxId), eq(stepParts.type, "text")))
      .orderBy(stepParts.seq)
      .all();
    const assistantText = textParts
      .map((p) => {
        try {
          const d = JSON.parse(p.data);
          return typeof d.content === "string" ? d.content : "";
        } catch {
          return "";
        }
      })
      .join("");

    history.push({
      role: "assistant",
      content: assistantText,
      timestamp: t.completedAt ?? t.startedAt,
      turnId: t.turnNumber,
      success: true,
    });
  }

  const content = systemBlock.trim();
  if (!content) return history;
  return [{ role: "system", content, timestamp: new Date().toISOString() }, ...history];
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

  return {
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
    parts: parts.map((p) => {
      try { return { ...JSON.parse(p.data), type: p.type, status: p.status, _seq: p.seq, toolCallId: p.toolCallId, toolName: p.toolName }; }
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
