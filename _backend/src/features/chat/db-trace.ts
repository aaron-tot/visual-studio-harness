import { eq, and, or, desc, isNull, max, sum, count, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb, getDbForDataDir } from "../../db/client";
import {
  sessions,
  turns,
  turnContext,
  steps,
  stepParts,
  promptSnapshots,
  toolsSnapshots,
} from "../../db/schema";
import type { TraceTurn, TraceStep, TraceStepPart } from "../../../../_shared/types/trace";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

// ── Turn helpers ─────────────────────────────────────────────────────

export function getNextTurnNumber(sessionId: string, dataDir?: string): number {
  const db = dbFor(dataDir);
  const row = db
    .select({ m: max(turns.turnNumber) })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .get();
  const current = row?.m;
  return (typeof current === "number" ? current : 0) + 1;
}

export function createTurn(
  sessionId: string,
  turnNumber: number,
  userContent: string,
  userTimestamp: string,
  opts?: {
    agentName?: string;
    modelName?: string;
    providerName?: string;
    maxSteps?: number;
    temperature?: number;
    thinkingEffort?: string;
  },
  dataDir?: string,
): number {
  const db = dbFor(dataDir);
  const result = db
    .insert(turns)
    .values({
      sessionId,
      turnNumber,
      userContent,
      userTimestamp,
      status: "streaming",
      startedAt: new Date().toISOString(),
      agentName: opts?.agentName ?? null,
      modelName: opts?.modelName ?? null,
      providerName: opts?.providerName ?? null,
      maxSteps: opts?.maxSteps ?? null,
      temperature: opts?.temperature ?? null,
      thinkingEffort: opts?.thinkingEffort ?? null,
    })
    .returning({ id: turns.id })
    .get();
  return result.id;
}

export function insertTurnContext(
  turnId: number,
  contextTurnIds: number[],
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  if (contextTurnIds.length === 0) return;

  // Validate: load current turn to check sessionId and turnNumber
  const currentTurn = db
    .select({ sessionId: turns.sessionId, turnNumber: turns.turnNumber })
    .from(turns)
    .where(eq(turns.id, turnId))
    .get();

  if (!currentTurn) {
    console.warn(`insertTurnContext: turn ${turnId} not found, skipping`);
    return;
  }

  const validContextIds: number[] = [];
  for (const ctxId of contextTurnIds) {
    const ctxTurn = db
      .select({ sessionId: turns.sessionId, turnNumber: turns.turnNumber })
      .from(turns)
      .where(eq(turns.id, ctxId))
      .get();

    if (!ctxTurn) {
      console.warn(`insertTurnContext: contextTurnId ${ctxId} not found, skipping`);
      continue;
    }
    if (ctxTurn.sessionId !== currentTurn.sessionId) {
      console.warn(`insertTurnContext: contextTurnId ${ctxId} belongs to session ${ctxTurn.sessionId}, not ${currentTurn.sessionId}, skipping`);
      continue;
    }
    if (ctxTurn.turnNumber >= currentTurn.turnNumber) {
      console.warn(`insertTurnContext: contextTurnId ${ctxId} has turnNumber ${ctxTurn.turnNumber} >= current ${currentTurn.turnNumber}, skipping`);
      continue;
    }
    validContextIds.push(ctxId);
  }

  if (validContextIds.length === 0) return;
  const values = validContextIds.map((ctxId, i) => ({
    turnId,
    contextTurnId: ctxId,
    position: i,
  }));
  db.insert(turnContext).values(values).run();
}

export function listContextTurnIds(turnId: number, dataDir?: string): number[] {
  const db = dbFor(dataDir);
  const rows = db
    .select({ contextTurnId: turnContext.contextTurnId })
    .from(turnContext)
    .where(eq(turnContext.turnId, turnId))
    .orderBy(turnContext.position)
    .all();
  return rows.map((r) => r.contextTurnId);
}

// ── Snapshot helpers ─────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function ensurePromptSnapshot(content: string, dataDir?: string): number {
  const db = dbFor(dataDir);
  const hash = sha256(content);
  const existing = db
    .select({ id: promptSnapshots.id })
    .from(promptSnapshots)
    .where(eq(promptSnapshots.contentHash, hash))
    .get();
  if (existing) return existing.id;
  const result = db
    .insert(promptSnapshots)
    .values({ contentHash: hash, content, createdAt: new Date().toISOString() })
    .returning({ id: promptSnapshots.id })
    .get();
  return result.id;
}

export function ensureToolsSnapshot(toolsJson: string, dataDir?: string): number {
  const db = dbFor(dataDir);
  const canonical = JSON.stringify(JSON.parse(toolsJson), Object.keys(JSON.parse(toolsJson)).sort());
  const hash = sha256(canonical);
  const existing = db
    .select({ id: toolsSnapshots.id })
    .from(toolsSnapshots)
    .where(eq(toolsSnapshots.contentHash, hash))
    .get();
  if (existing) return existing.id;
  const parsed = JSON.parse(toolsJson);
  const names = Array.isArray(parsed) ? parsed.map((t: any) => t.name ?? t.function?.name).filter(Boolean) : [];
  const result = db
    .insert(toolsSnapshots)
    .values({
      contentHash: hash,
      toolsJson: canonical,
      toolNamesJson: names.length > 0 ? JSON.stringify(names) : null,
      createdAt: new Date().toISOString(),
    })
    .returning({ id: toolsSnapshots.id })
    .get();
  return result.id;
}

export function updateTurnSnapshots(
  turnId: number,
  promptSnapshotId?: number,
  toolsSnapshotId?: number,
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  const updates: Record<string, unknown> = {};
  if (promptSnapshotId !== undefined) updates.systemPromptSnapshotId = promptSnapshotId;
  if (toolsSnapshotId !== undefined) updates.toolsSnapshotId = toolsSnapshotId;
  if (Object.keys(updates).length > 0) {
    db.update(turns).set(updates).where(eq(turns.id, turnId)).run();
  }
}

// ── Step helpers ─────────────────────────────────────────────────────

export function createStep(
  turnId: number,
  sessionId: string,
  stepIndex: number,
  opts?: {
    providerName?: string;
    modelId?: string;
    callId?: string;
    requestMetaJson?: string;
    warningsJson?: string;
  },
  dataDir?: string,
): number {
  const db = dbFor(dataDir);
  const result = db
    .insert(steps)
    .values({
      sessionId,
      turnId,
      stepIndex,
      status: "streaming",
      providerName: opts?.providerName ?? null,
      modelId: opts?.modelId ?? null,
      callId: opts?.callId ?? null,
      requestMetaJson: opts?.requestMetaJson ?? null,
      warningsJson: opts?.warningsJson ?? null,
      startedAt: new Date().toISOString(),
    })
    .returning({ id: steps.id })
    .get();
  return result.id;
}

export function finalizeStep(
  stepId: number,
  opts: {
    finishReason?: string;
    rawFinishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheInputTokens?: number;
    usageRawJson?: string;
    stepTimeMs?: number;
    responseTimeMs?: number;
    timeToFirstOutputMs?: number;
    effectiveOutputTps?: number;
    outputTps?: number;
    inputTps?: number;
    toolExecutionMsJson?: string;
    performanceJson?: string;
    providerMetadataJson?: string;
    warningsJson?: string;
    responseId?: string;
    responseModelId?: string;
  },
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  db.update(steps)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      finishReason: opts.finishReason ?? null,
      rawFinishReason: opts.rawFinishReason ?? null,
      inputTokens: opts.inputTokens ?? null,
      outputTokens: opts.outputTokens ?? null,
      totalTokens: opts.totalTokens ?? null,
      reasoningTokens: opts.reasoningTokens ?? null,
      cacheReadTokens: opts.cacheReadTokens ?? null,
      cacheWriteTokens: opts.cacheWriteTokens ?? null,
      noCacheInputTokens: opts.noCacheInputTokens ?? null,
      usageRawJson: opts.usageRawJson ?? null,
      stepTimeMs: opts.stepTimeMs ?? null,
      responseTimeMs: opts.responseTimeMs ?? null,
      timeToFirstOutputMs: opts.timeToFirstOutputMs ?? null,
      effectiveOutputTps: opts.effectiveOutputTps ?? null,
      outputTps: opts.outputTps ?? null,
      inputTps: opts.inputTps ?? null,
      toolExecutionMsJson: opts.toolExecutionMsJson ?? null,
      performanceJson: opts.performanceJson ?? null,
      providerMetadataJson: opts.providerMetadataJson ?? null,
      warningsJson: opts.warningsJson ?? null,
      responseId: opts.responseId ?? null,
      responseModelId: opts.responseModelId ?? null,
    })
    .where(eq(steps.id, stepId))
    .run();
}

// ── Step part helpers ────────────────────────────────────────────────

export function insertStepPart(
  sessionId: string,
  turnId: number,
  stepId: number,
  type: string,
  data: unknown,
  seq: number,
  status?: string,
  opts?: { toolCallId?: string; toolName?: string; parentToolCallId?: string },
  dataDir?: string,
): number {
  const db = dbFor(dataDir);
  const result = db
    .insert(stepParts)
    .values({
      sessionId,
      turnId,
      stepId,
      type,
      seq,
      status: status ?? null,
      data: JSON.stringify(data),
      toolCallId: opts?.toolCallId ?? null,
      toolName: opts?.toolName ?? null,
      parentToolCallId: opts?.parentToolCallId ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning({ id: stepParts.id })
    .get();
  return result.id;
}

export function updateStepPartData(
  partId: number,
  data: unknown,
  opts?: { seq?: number; status?: string },
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  const updateData: Record<string, unknown> = {
    data: JSON.stringify(data),
    updatedAt: new Date().toISOString(),
  };
  if (opts?.seq != null) updateData.seq = opts.seq;
  if (opts?.status != null) updateData.status = opts.status;
  db.update(stepParts).set(updateData).where(eq(stepParts.id, partId)).run();
}

export function updateStepPartStatus(
  partId: number,
  status: string,
  data?: unknown,
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  const updateData: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
  if (data !== undefined) {
    updateData.data = JSON.stringify(data);
  }
  db.update(stepParts).set(updateData).where(eq(stepParts.id, partId)).run();
}

// ── Read helpers (for unit tests; full chat projection in Phase 4) ───

export function getTurnById(turnId: number, dataDir?: string): TraceTurn | null {
  const db = dbFor(dataDir);
  const row = db.select().from(turns).where(eq(turns.id, turnId)).get();
  if (!row) return null;
  return row as unknown as TraceTurn;
}

export function getTurnByNumber(
  sessionId: string,
  turnNumber: number,
  dataDir?: string,
): TraceTurn | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get();
  if (!row) return null;
  return row as unknown as TraceTurn;
}

export function listStepsForTurn(turnId: number, dataDir?: string): TraceStep[] {
  const db = dbFor(dataDir);
  return db
    .select()
    .from(steps)
    .where(eq(steps.turnId, turnId))
    .orderBy(steps.stepIndex)
    .all() as unknown as TraceStep[];
}

export function listStepPartsForTurn(turnId: number, dataDir?: string): TraceStepPart[] {
  const db = dbFor(dataDir);
  return db
    .select()
    .from(stepParts)
    .where(eq(stepParts.turnId, turnId))
    .orderBy(stepParts.seq)
    .all() as unknown as TraceStepPart[];
}

// ── Retry support ─────────────────────────────────────────────────────

export function clearTurnSteps(turnId: number, dataDir?: string): void {
  const db = dbFor(dataDir);
  db.delete(stepParts).where(eq(stepParts.turnId, turnId)).run();
  db.delete(steps).where(eq(steps.turnId, turnId)).run();
}

// ── Aggregate helpers ────────────────────────────────────────────────

export function recomputeTurnUsage(turnId: number, dataDir?: string): void {
  const db = dbFor(dataDir);
  const row = db
    .select({
      inputTokens: sum(steps.inputTokens),
      outputTokens: sum(steps.outputTokens),
      totalTokens: sum(steps.totalTokens),
      reasoningTokens: sum(steps.reasoningTokens),
      cacheReadTokens: sum(steps.cacheReadTokens),
      cacheWriteTokens: sum(steps.cacheWriteTokens),
      stepCount: count(),
    })
    .from(steps)
    .where(eq(steps.turnId, turnId))
    .get();
  db.update(turns)
    .set({
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      reasoningTokens: Number(row?.reasoningTokens ?? 0),
      cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
      cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
      stepCount: Number(row?.stepCount ?? 0),
    })
    .where(eq(turns.id, turnId))
    .run();
}

export function recomputeSessionUsage(sessionId: string, dataDir?: string): void {
  const db = dbFor(dataDir);
  const row = db
    .select({
      inputTokens: sum(turns.inputTokens),
      outputTokens: sum(turns.outputTokens),
      totalTokens: sum(turns.totalTokens),
      reasoningTokens: sum(turns.reasoningTokens),
      turnCount: sum(sql`CASE WHEN ${turns.success} = 1 THEN 1 ELSE 0 END`),
    })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.success, true)))
    .get();
  db.update(sessions)
    .set({
      cachedInputTokens: Number(row?.inputTokens ?? 0),
      cachedOutputTokens: Number(row?.outputTokens ?? 0),
      cachedTotalTokens: Number(row?.totalTokens ?? 0),
      cachedTurnCount: Number(row?.turnCount ?? 0),
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

// ── Finalize / abort ─────────────────────────────────────────────────

export function finalizeTurnTrace(
  turnId: number,
  outcome: { success: boolean; finishReason?: string; errorMessage?: string; errorRaw?: string; errorIsCustom?: boolean },
  dataDir?: string,
): void {
  const db = dbFor(dataDir);

  // Recompute turn usage from steps
  recomputeTurnUsage(turnId, dataDir);

  // Close open step_parts
  db.update(stepParts)
    .set({ status: "completed", updatedAt: new Date().toISOString() })
    .where(and(eq(stepParts.turnId, turnId), isNull(stepParts.status)))
    .run();

  // Finalize turn
  const now = new Date().toISOString();
  const turnRow = db
    .select({ startedAt: turns.startedAt, sessionId: turns.sessionId })
    .from(turns)
    .where(eq(turns.id, turnId))
    .get();

  let durationMs: number | null = null;
  if (turnRow?.startedAt) {
    durationMs = Date.now() - new Date(turnRow.startedAt).getTime();
  }

  db.update(turns)
    .set({
      status: outcome.success ? "success" : "error",
      success: outcome.success,
      finishReason: outcome.finishReason ?? null,
      errorMessage: outcome.errorMessage ?? null,
      errorRaw: outcome.errorRaw ?? null,
      errorIsCustom: outcome.errorIsCustom ?? null,
      durationMs,
      completedAt: now,
    })
    .where(eq(turns.id, turnId))
    .run();

  // Update session cached totals
  if (turnRow?.sessionId) {
    recomputeSessionUsage(turnRow.sessionId, dataDir);
  }
}

export function abortTurnTrace(turnId: number, dataDir?: string): void {
  const db = dbFor(dataDir);

  // Complete any streaming step_parts (preserves partial content)
  db.update(stepParts)
    .set({ status: "completed", updatedAt: new Date().toISOString() })
    .where(and(eq(stepParts.turnId, turnId), or(isNull(stepParts.status), eq(stepParts.status, "streaming"))))
    .run();

  // Mark open steps as error (completed steps keep their status)
  db.update(steps)
    .set({ status: "error", completedAt: new Date().toISOString() })
    .where(and(eq(steps.turnId, turnId), eq(steps.status, "streaming")))
    .run();

  // Recompute turn usage from whatever steps exist (completed + errored)
  recomputeTurnUsage(turnId, dataDir);

  const now = new Date().toISOString();
  const turnRow = db
    .select({ startedAt: turns.startedAt, sessionId: turns.sessionId })
    .from(turns)
    .where(eq(turns.id, turnId))
    .get();

  let durationMs: number | null = null;
  if (turnRow?.startedAt) {
    durationMs = Date.now() - new Date(turnRow.startedAt).getTime();
  }

  db.update(turns)
    .set({
      status: "aborted",
      success: false,
      finishReason: "aborted",
      durationMs,
      completedAt: now,
    })
    .where(eq(turns.id, turnId))
    .run();

  // Update session cache
  if (turnRow?.sessionId) {
    recomputeSessionUsage(turnRow.sessionId, dataDir);
  }
}

// ── Raw capture ───────────────────────────────────────────────────────

export function updateTurnRawCapture(
  turnId: number,
  rawRequest: Record<string, unknown> | undefined,
  rawResponse: Record<string, unknown> | undefined,
  dataDir?: string,
): void {
  const db = dbFor(dataDir);
  const updates: Record<string, unknown> = {};
  if (rawRequest !== undefined) updates.rawRequestJson = JSON.stringify(rawRequest);
  if (rawResponse !== undefined) updates.rawResponseJson = JSON.stringify(rawResponse);
  if (Object.keys(updates).length > 0) {
    db.update(turns).set(updates).where(eq(turns.id, turnId)).run();
  }
}

// ── Utility ──────────────────────────────────────────────────────────

export function getActiveTraceTurn(sessionId: string, dataDir?: string): TraceTurn | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.status, "streaming")))
    .orderBy(desc(turns.id))
    .get();
  if (!row) return null;
  return row as unknown as TraceTurn;
}

export function sessionHasTurns(sessionId: string, dataDir?: string): boolean {
  const db = dbFor(dataDir);
  const row = db
    .select({ id: turns.id })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .limit(1)
    .get();
  return !!row;
}
