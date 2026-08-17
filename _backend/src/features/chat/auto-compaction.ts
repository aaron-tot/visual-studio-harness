/**
 * Auto compaction (v2): when a turn completes and the provider-reported input
 * context of its last step is at/above a configured token threshold, compact
 * the conversation by (a) summarizing the currently in-context turns into a new
 * summary turn (reusing the summarizer + chain) and (b) pinning the session
 * context to that summary. Subsequent turns then receive the compact summary
 * (message-builder injects it) plus any fresh turns after it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, desc } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, stepParts, steps } from "../../db/schema";
import { cloneRangeTurnsToChild } from "./summary-clone";
import { generateId } from "./run-turn/util";
import { createStepStreamWriter } from "./persist-stream";
import { insertSubagentSpawn } from "../subagents/db";
import {
  createSession,
  markSummaryTurnError,
  getSessionModelConfigJson,
  setSessionModelConfigJson,
  getLatestSummaryRangeBefore,
  insertSummaryRange,
} from "../sessions/db";
import {
  getNextTurnNumber,
  createTurn,
  createStep,
  finalizeStep,
} from "./db-trace";
import { projectSessionChat } from "./project-chat";
import {
  runSummarizer,
  buildSummarizationMessages,
  readSummarizationPrompt,
} from "../sessions/summarizer";
import { sendSessionStateToSession } from "../sessions/view-tracker";
import type { ContextScopeConfig } from "./context-window";

/** Sessions currently performing an auto compaction (avoids double-firing). */
const compactingSessions = new Set<string>();

interface EffectiveAutoConfig {
  enabled: boolean;
  triggerTokens: number;
  modelRef: string | null;
  fallbackModelRef: string | null;
  promptMd: string | null;
  summarizeIncludePriorSummary: boolean;
}

function readScopedCtx(dataDir: string): { global: Record<string, unknown>; workspaces: Record<string, unknown> } {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "context-config.json"), "utf-8")) as {
      global?: Record<string, unknown>;
      workspaces?: Record<string, Record<string, unknown>>;
    };
    return { global: raw.global ?? {}, workspaces: raw.workspaces ?? {} };
  } catch {
    return { global: {}, workspaces: {} };
  }
}

/**
 * Resolve effective auto-compaction config with the same precedence as the
 * rest of the context config: session (if enabled) > project (if enabled) >
 * global (base). Global is never gated.
 */
function resolveEffectiveAutoConfig(
  sessionId: string,
  dataDir: string,
  workspaceRoot?: string,
): EffectiveAutoConfig {
  let sessionCtx: ContextScopeConfig | null = null;
  try {
    const raw = getSessionModelConfigJson(sessionId, dataDir);
    if (raw) sessionCtx = (JSON.parse(raw)?.context as ContextScopeConfig) ?? null;
  } catch { /* ignore */ }

  const scoped = readScopedCtx(dataDir);
  const global = scoped.global as ContextScopeConfig;
  const project = workspaceRoot ? (scoped.workspaces[workspaceRoot] as ContextScopeConfig | undefined) ?? null : null;

  const sessionOn = sessionCtx?.enabled === true;
  const projectOn = project?.enabled === true;

  const scopeAs = (c: ContextScopeConfig | null | undefined): Record<string, unknown> =>
  (c as Record<string, unknown>) ?? {};

  const val = <T>(key: "autoCompactionEnabled" | "autoCompactionTriggerTokens" | "summarizationModel" | "summarizationFallbackModel" | "summarizationPromptMd" | "summarizeIncludePriorSummary"): T | undefined => {
    if (sessionOn && scopeAs(sessionCtx)[key] !== undefined) return scopeAs(sessionCtx)[key] as T;
    if (projectOn && scopeAs(project)[key] !== undefined) return scopeAs(project)[key] as T;
    if (scopeAs(global)[key] !== undefined) return scopeAs(global)[key] as T;
    return undefined;
  };

  return {
    enabled: val<boolean>("autoCompactionEnabled") ?? false,
    triggerTokens: val<number>("autoCompactionTriggerTokens") ?? 0,
    modelRef: val<string>("summarizationModel") ?? null,
    fallbackModelRef: val<string>("summarizationFallbackModel") ?? null,
    promptMd: val<string>("summarizationPromptMd") ?? null,
    summarizeIncludePriorSummary: val<boolean>("summarizeIncludePriorSummary") ?? true,
  };
}

function readSummaryText(dataDir: string, summaryTurnId: number): string | null {
  const db = getDbForDataDir(dataDir);
  const part = db
    .select({ data: stepParts.data })
    .from(stepParts)
    .where(and(eq(stepParts.turnId, summaryTurnId), eq(stepParts.type, "text")))
    .orderBy(stepParts.seq)
    .limit(1)
    .get();
  if (!part?.data) return null;
  try {
    const parsed = JSON.parse(part.data);
    return typeof parsed.content === "string" && parsed.content ? parsed.content : null;
  } catch {
    return String(part.data) || null;
  }
}

/**
 * Trigger entry point, called when a turn completes.
 * Returns true if a compaction was started.
 */
export async function maybeAutoCompact(
  sessionId: string,
  dataDir: string,
  workspaceRoot?: string,
): Promise<boolean> {
  if (!dataDir || compactingSessions.has(sessionId)) return false;

  const cfg = resolveEffectiveAutoConfig(sessionId, dataDir, workspaceRoot);
  if (!cfg.enabled || !cfg.triggerTokens || cfg.triggerTokens <= 0) return false;

  const db = getDbForDataDir(dataDir);
  const lastLive = db
    .select({ turnNumber: turns.turnNumber, inputTokens: turns.inputTokens, cacheReadTokens: turns.cacheReadTokens })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn"), eq(turns.success, true)))
    .orderBy(desc(turns.turnNumber))
    .limit(1)
    .get();
  if (!lastLive) return false;

  const lastInputTokens = (lastLive.inputTokens ?? 0) + (lastLive.cacheReadTokens ?? 0);
  if (lastInputTokens < cfg.triggerTokens) return false;

  // Nothing left to compact (a summary already covers the whole conversation).
  const prior = getLatestSummaryRangeBefore(dataDir, sessionId, lastLive.turnNumber);
  if (prior && prior.endTurn >= lastLive.turnNumber) return false;

  compactingSessions.add(sessionId);
  try {
    console.error(`[auto-compaction] session=${sessionId} inputTokens=${lastInputTokens} threshold=${cfg.triggerTokens} → compacting`);
    await performAutoCompaction(sessionId, dataDir, workspaceRoot, cfg, lastLive.turnNumber);
    return true;
  } finally {
    compactingSessions.delete(sessionId);
    try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }
  }
}

async function performAutoCompaction(
  sessionId: string,
  dataDir: string,
  workspaceRoot: string | undefined,
  cfg: EffectiveAutoConfig,
  endTurnNum: number,
): Promise<void> {
  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();

  // Range to compact: from after the prior summary (or turn 1) through endTurnNum.
  const prior = getLatestSummaryRangeBefore(dataDir, sessionId, endTurnNum);
  const startTurn = prior ? prior.endTurn + 1 : 1;
  if (startTurn > endTurnNum) return;

  // Reconstruct the covered turns (user + assistant text, excluding summaries),
  // both for the summarizer input and for cloning into the child session.
  const chatMessages = projectSessionChat(sessionId, dataDir) as unknown as {
    turnId: number | null; isSummary?: boolean; role: string; content: string;
  }[];
  const rangeTurns: { role: "user" | "assistant"; content: string }[] = [];
  const rangeGroups: { userContent: string; assistantContents: string[] }[] = [];
  {
    let cur: { userContent: string; assistantContents: string[] } | null = null;
    for (const m of chatMessages) {
      if (m.isSummary) continue;
      const tn = m.turnId;
      if (tn == null || tn < startTurn || tn > endTurnNum) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (!m.content) continue;
      rangeTurns.push({ role: m.role as "user" | "assistant", content: m.content });
      if (m.role === "user") {
        if (cur) rangeGroups.push(cur);
        cur = { userContent: m.content, assistantContents: [] };
      } else if (m.role === "assistant") {
        if (!cur) cur = { userContent: "", assistantContents: [] };
        cur.assistantContents.push(m.content);
      }
    }
    if (cur) rangeGroups.push(cur);
  }
  if (rangeTurns.length === 0) return;

  // Prior chain summary text (chaining).
  let priorSummary: string | null = null;
  if (cfg.summarizeIncludePriorSummary && prior) {
    priorSummary = readSummaryText(dataDir, prior.summaryTurnId);
  }
  const messages = buildSummarizationMessages(priorSummary, rangeTurns);

  if (!cfg.modelRef || !/^[^/]+\/[^/]+$/.test(cfg.modelRef)) {
    console.error("[auto-compaction] no valid summarization model configured; skipping");
    return;
  }
  const promptContent = (await readSummarizationPrompt(cfg.promptMd)) ?? `Summarize conversation turns ${startTurn}–${endTurnNum}`;
  const originalTokens = db
    .select({ n: turns.turnNumber, t: turns.totalTokens })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
    .all()
    .filter((r) => r.n >= startTurn && r.n <= endTurnNum)
    .reduce((s, r) => s + (r.t ?? 0), 0);

  const initiatorLabel = "auto";

  // ── Child session (same as manual summarize-range) so the user can open it
  // and watch the summary stream live; usage lands here and is linked via the
  // subagent spawn edge. ─────────────────────────────────────────────────────
  const childSessionId = generateId();
  const childLabel = `Summary: turns ${startTurn}–${endTurnNum}`;
  createSession({
    id: childSessionId,
    title: childLabel,
    kind: "subagent",
    parentId: sessionId,
    taskLabel: childLabel,
    providerName: cfg.modelRef.split("/")[0] ?? "",
    modelName: cfg.modelRef.split("/")[1] ?? "",
    workspaceRoot,
    created: now,
    updated: now,
  }, dataDir);
  let priorSummaryGroup: { userContent: string; assistantContents: string[] } | null = null;
  if (cfg.summarizeIncludePriorSummary && prior && priorSummary) {
    const priorTurn = db
      .select({ userContent: turns.userContent })
      .from(turns)
      .where(eq(turns.id, prior.summaryTurnId))
      .get();
    priorSummaryGroup = {
      userContent: priorTurn?.userContent || "Previous summary:",
      assistantContents: [priorSummary],
    };
  }
  cloneRangeTurnsToChild(dataDir, childSessionId, rangeGroups, now, priorSummaryGroup);
  const childTurnNumber = getNextTurnNumber(childSessionId, dataDir);
  const childTurnId = createTurn(childSessionId, childTurnNumber, promptContent, now, {
    providerName: cfg.modelRef.split("/")[0] ?? "unknown",
    modelName: cfg.modelRef.split("/")[1] ?? "summarizer",
  }, dataDir);
  const childStepId = createStep(childTurnId, childSessionId, 0, {
    providerName: cfg.modelRef.split("/")[0] ?? "unknown",
    modelId: cfg.modelRef.split("/")[1] ?? "summarizer",
  }, dataDir);
  const childWriter = createStepStreamWriter(childSessionId, childTurnId, childStepId, dataDir);
  let childPartSeq = 0;

  // Placeholder main-session summary row (pending) so clients see it + the
  // open-sub-session icon immediately while generation runs.
  const placeholderContent = `SUMMARY BEING GENERATED AT ${now}: initiated by [${initiatorLabel}]`;
  const summaryMeta = {
    kind: "summary",
    promptMd: cfg.promptMd ?? null,
    model: cfg.modelRef,
    provider: cfg.modelRef.split("/")[0] ?? null,
    range: { startTurn, endTurn: endTurnNum },
    prevRangeId: prior?.id ?? null,
    originalTokens,
    summaryTokens: 0,
    initiatedAt: now,
    initiator: initiatorLabel,
    childSessionId,
    childTurnNumber,
  };
  const summaryTurnNumber = getNextTurnNumber(sessionId, dataDir);
  const summaryTurnResult = db.insert(turns).values({
    sessionId,
    turnNumber: summaryTurnNumber,
    userContent: placeholderContent,
    userTimestamp: now,
    status: "pending",
    success: false,
    providerName: cfg.modelRef.split("/")[0] ?? "unknown",
    modelName: cfg.modelRef.split("/")[1] ?? "summarizer",
    finishReason: null,
    durationMs: 0,
    startedAt: now,
    completedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    stepCount: 0,
    kind: "summary",
    configSnapshotJson: JSON.stringify(summaryMeta),
  }).returning({ id: turns.id }).get();
  const summaryTurnId = summaryTurnResult?.id;
  if (!summaryTurnId) {
    console.error("[auto-compaction] failed to create summary turn");
    return;
  }
  try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }

  // Run the summarizer, streaming into the child session.
  const startedMs = Date.now();
  let lastChildPush = 0;
  const pushChildThrottled = () => {
    const t = Date.now();
    if (t - lastChildPush < 250) return;
    lastChildPush = t;
    try { sendSessionStateToSession(childSessionId); } catch { /* ignore */ }
  };
  let result: { text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number } | null };
  try {
    result = await runSummarizer(dataDir, {
      promptMd: cfg.promptMd,
      modelRef: cfg.modelRef,
      fallbackModelRef: cfg.fallbackModelRef,
      messages,
      sessionId,
      workspaceRoot,
      onStream: ({ type, text }) => {
        childWriter.writeDelta(type, text, childPartSeq++);
        pushChildThrottled();
      },
    });
  } catch (err) {
    childWriter.closeOpen();
    db.update(turns).set({
      status: "error", success: false, finishReason: "error",
      durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    }).where(eq(turns.id, childTurnId)).run();
    db.update(steps).set({ status: "error", finishReason: "error", completedAt: new Date().toISOString() })
      .where(eq(steps.id, childStepId)).run();
    markSummaryTurnError(dataDir, summaryTurnId);
    try { sendSessionStateToSession(childSessionId); } catch { /* ignore */ }
    try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }
    console.error("[auto-compaction] summarize failed:", err);
    return;
  }
  const summaryText = (result.text ?? "").trim();
  const usage = result.usage;
  if (!summaryText) {
    childWriter.closeOpen();
    db.update(turns).set({ status: "error", success: false, finishReason: "error", completedAt: new Date().toISOString() })
      .where(eq(turns.id, childTurnId)).run();
    markSummaryTurnError(dataDir, summaryTurnId);
    return;
  }

  // Finalize the child turn + step (real usage) and mark its parts complete.
  childWriter.closeOpen();
  db.update(stepParts).set({ status: "completed" }).where(eq(stepParts.turnId, childTurnId)).run();
  db.update(turns).set({
    status: "success", success: true, finishReason: "stop",
    durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(),
    inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    reasoningTokens: (usage as { reasoningTokens?: number } | undefined)?.reasoningTokens ?? 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, stepCount: 1,
  }).where(eq(turns.id, childTurnId)).run();
  finalizeStep(childStepId, {
    finishReason: "stop", inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    reasoningTokens: (usage as { reasoningTokens?: number } | undefined)?.reasoningTokens ?? 0,
    stepTimeMs: Math.max(0, Date.now() - startedMs),
  }, dataDir);

  // Finalize the main summary turn + a text step part (message-builder reads it).
  db.update(turns).set({
    userContent: promptContent, status: "success", success: true, finishReason: "stop",
    durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(),
    inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    reasoningTokens: (usage as { reasoningTokens?: number } | undefined)?.reasoningTokens ?? 0,
    stepCount: 1,
    configSnapshotJson: JSON.stringify({ ...summaryMeta, summaryTokens: usage?.totalTokens ?? 0 }),
  }).where(eq(turns.id, summaryTurnId)).run();
  const stepResult = db.insert(steps).values({
    sessionId, turnId: summaryTurnId, stepIndex: 0, status: "completed",
    providerName: cfg.modelRef.split("/")[0] ?? "unknown",
    modelId: cfg.modelRef.split("/")[1] ?? "summarizer",
    finishReason: "stop", startedAt: now, completedAt: now, stepTimeMs: 0,
  }).returning({ id: steps.id }).get();
  const stepId = stepResult?.id;
  if (stepId) {
    db.insert(stepParts).values({
      sessionId, turnId: summaryTurnId, stepId, type: "text", seq: 0, status: "completed",
      data: JSON.stringify({ content: summaryText }), createdAt: now,
    }).run();
  }

  // Spawn edge: main summary turn/step → child session+turn (usage tree).
  insertSubagentSpawn({
    parentSessionId: sessionId, parentTurnId: summaryTurnId, parentTurnNumber: summaryTurnNumber,
    parentStepId: stepId ?? null, parentStepIndex: 0, toolCallId: `summary-${summaryTurnId}`,
    childSessionId, childTurnId, childTurnNumber, kind: "spawn", taskLabel: childLabel,
  }, dataDir);

  // Summary range.
  insertSummaryRange(dataDir, {
    sessionId, summaryTurnId, startTurn, endTurn: endTurnNum,
    prevRangeId: prior?.id ?? null, originalTokens, summaryTokens: usage?.totalTokens ?? 0, createdAt: now,
  });

  // Push both sessions.
  try { sendSessionStateToSession(childSessionId); } catch { /* ignore */ }
  try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }

  // Pin context to the new summary (summary turn itself = normal context turn).
  const pinnedTurn = summaryTurnNumber;
  try {
    const raw = getSessionModelConfigJson(sessionId, dataDir);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.context = { ...(parsed.context ?? {}), mode: "fixed", pinnedTurn, enabled: true };
    setSessionModelConfigJson(sessionId, JSON.stringify(parsed), dataDir);
  } catch (err) {
    console.error("[auto-compaction] could not pin context:", err);
  }

  console.error(
    `[auto-compaction] ok session=${sessionId} range=${startTurn}–${endTurnNum} summaryTurn=${summaryTurnNumber} child=${childSessionId} pinnedTurn=${pinnedTurn}`,
  );
}
