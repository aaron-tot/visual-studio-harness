/**
 * Shared single-block summarization executor.
 *
 * Both the auto-compaction path and the manual /summarize-range endpoint drive
 * this in a LOOP over planned blocks. Each invocation summarizes ONE block (a
 * slice of turns) into its own child (subagent) session and installs one
 * summary turn + one summary_ranges row chained via prevRangeId.
 *
 * The summarizer input is ALWAYS built with the prior summary text (chained) —
 * per R6 the summarizeIncludePriorSummary toggle does not govern block
 * continuity; callers decide what to pass as `priorSummary`.
 *
 * This module is self-contained (no import from auto-compaction) to avoid a
 * circular dependency. Callers translate thrown errors as needed.
 */
import { and, eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, stepParts, steps } from "../../db/schema";
import { generateId } from "../chat/run-turn/util";
import { createStepStreamWriter } from "../chat/persist-stream";
import { insertSubagentSpawn } from "../subagents/db";
import { createSession, markSummaryTurnError, insertSummaryRange } from "./db";
import { getNextTurnNumber, createTurn, createStep, finalizeStep } from "../chat/db-trace";
import { runSummarizer, readSummarizationPrompt, buildSummarizationMessages } from "./summarizer";
import { cloneRangeTurnsToChild } from "../chat/summary-clone";
import { sendSessionStateToSession } from "./view-tracker";

export interface SummaryBlockInput {
  dataDir: string;
  sessionId: string;
  workspaceRoot?: string;
  startTurn: number;
  endTurn: number;
  rangeTurns: { role: "user" | "assistant"; content: string }[];
  rangeGroups: { userContent: string; assistantContents: string[] }[];
  /** Prior summary TEXT (chained) — fed into the prompt. Null only when no chain. */
  priorSummary: string | null;
  /** Prior summary cloned as a normal turn into the child (for continuity view). */
  priorCloneGroup?: { userContent: string; assistantContents: string[] } | null;
  /** Prior range id to chain from (prevRangeId). Null for the first block. */
  prevRangeId?: number | null;
  modelRef: string | null;
  fallbackModelRef?: string | null;
  promptMd?: string | null;
  /** Effective initiator label ("auto", "manual", slider, ...). */
  initiator: string;
}

export interface BlockSummaryResult {
  summaryTurnId: number;
  summaryTurnNumber: number;
  startTurn: number;
  endTurn: number;
  summaryText: string;
  originalTokens: number;
  summaryTokens: number;
  childSessionId: string;
}

/** Throws a plain Error on summarizer failure; callers wrap as needed. */
export async function runSummaryBlock(input: SummaryBlockInput): Promise<BlockSummaryResult> {
  const {
    dataDir, sessionId, workspaceRoot, startTurn, endTurn,
    rangeTurns, rangeGroups, priorSummary, priorCloneGroup,
    modelRef, fallbackModelRef, promptMd, initiator,
  } = input;

  if (!modelRef || !/^[^/]+\/[^/]+$/.test(modelRef)) {
    throw new Error(`summary block: no valid summarization model (${modelRef})`);
  }

  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();
  const promptContent = (await readSummarizationPrompt(promptMd)) ?? `Summarize conversation turns ${startTurn}–${endTurn}`;

  // Original tokens = sum of covered turns' main-model totalTokens (accounting only).
  const originalTokens = db
    .select({ n: turns.turnNumber, t: turns.totalTokens })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
    .all()
    .filter((r) => r.n >= startTurn && r.n <= endTurn)
    .reduce((s, r) => s + (r.t ?? 0), 0);

  // ── Child (subagent) session for this block ──────────────────────────────
  const childSessionId = generateId();
  const childLabel = `Summary: turns ${startTurn}–${endTurn}`;
  createSession(
    { id: childSessionId, title: childLabel, kind: "subagent", parentId: sessionId, taskLabel: childLabel, providerName: modelRef.split("/")[0] ?? "", modelName: modelRef.split("/")[1] ?? "", workspaceRoot, created: now, updated: now },
    dataDir,
  );

  cloneRangeTurnsToChild(dataDir, childSessionId, rangeGroups, now, priorCloneGroup ?? null);

  const childTurnNumber = getNextTurnNumber(childSessionId, dataDir);
  const childTurnId = createTurn(childSessionId, childTurnNumber, promptContent, now, { providerName: modelRef.split("/")[0] ?? "unknown", modelName: modelRef.split("/")[1] ?? "summarizer" }, dataDir);
  const childStepId = createStep(childTurnId, childSessionId, 0, { providerName: modelRef.split("/")[0] ?? "unknown", modelId: modelRef.split("/")[1] ?? "summarizer" }, dataDir);
  const childWriter = createStepStreamWriter(childSessionId, childTurnId, childStepId, dataDir);
  let childPartSeq = 0;

  // ── Placeholder summary turn in the main session (pending) ──────────────
  const placeholderContent = `SUMMARY BEING GENERATED AT ${now}: initiated by [${initiator}]`;
  const summaryMeta = {
    kind: "summary",
    promptMd: promptMd ?? null,
    model: modelRef,
    provider: modelRef.split("/")[0] ?? null,
    range: { startTurn, endTurn },
    originalTokens,
    summaryTokens: 0,
    initiatedAt: now,
    initiator,
    childSessionId,
    childTurnNumber,
  };
  const summaryTurnNumber = getNextTurnNumber(sessionId, dataDir);
  const summaryTurnResult = db.insert(turns).values({
    sessionId, turnNumber: summaryTurnNumber, userContent: placeholderContent, userTimestamp: now,
    status: "pending", success: false, providerName: modelRef.split("/")[0] ?? "unknown", modelName: modelRef.split("/")[1] ?? "summarizer",
    finishReason: null, durationMs: 0, startedAt: now, completedAt: null, inputTokens: 0, outputTokens: 0,
    totalTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, stepCount: 0, kind: "summary",
    configSnapshotJson: JSON.stringify(summaryMeta),
  }).returning({ id: turns.id }).get();
  const summaryTurnId = summaryTurnResult?.id;
  if (!summaryTurnId) throw new Error("summary block: failed to create summary turn");
  try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }

  const messages = buildSummarizationMessages(priorSummary, rangeTurns);
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
      promptMd, modelRef, fallbackModelRef, messages, sessionId, workspaceRoot,
      onStream: ({ type, text }) => { childWriter.writeDelta(type, text, childPartSeq++); pushChildThrottled(); },
    });
  } catch (err) {
    childWriter.closeOpen();
    db.update(turns).set({ status: "error", success: false, finishReason: "error", durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(), errorMessage: err instanceof Error ? err.message : String(err) }).where(eq(turns.id, childTurnId)).run();
    db.update(steps).set({ status: "error", finishReason: "error", completedAt: new Date().toISOString() }).where(eq(steps.id, childStepId)).run();
    markSummaryTurnError(dataDir, summaryTurnId);
    try { sendSessionStateToSession(childSessionId); } catch { /* ignore */ }
    try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }
    throw err;
  }

  const summaryText = (result.text ?? "").trim();
  const usage = result.usage;
  if (!summaryText) {
    childWriter.closeOpen();
    db.update(turns).set({ status: "error", success: false, finishReason: "error", completedAt: new Date().toISOString() }).where(eq(turns.id, childTurnId)).run();
    markSummaryTurnError(dataDir, summaryTurnId);
    throw new Error("summary block: summary produced no text");
  }

  // Finalize child turn + step with real usage.
  childWriter.closeOpen();
  db.update(stepParts).set({ status: "completed" }).where(eq(stepParts.turnId, childTurnId)).run();
  db.update(turns).set({ status: "success", success: true, finishReason: "stop", durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(), inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0, stepCount: 1 }).where(eq(turns.id, childTurnId)).run();
  finalizeStep(childStepId, { finishReason: "stop", inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0, stepTimeMs: Math.max(0, Date.now() - startedMs) }, dataDir);

  // Finalize the main summary turn + step + text part.
  db.update(turns).set({ userContent: promptContent, status: "success", success: true, finishReason: "stop", durationMs: Math.max(0, Date.now() - startedMs), completedAt: new Date().toISOString(), inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0, stepCount: 1, configSnapshotJson: JSON.stringify({ ...summaryMeta, summaryTokens: usage?.totalTokens ?? 0 }) }).where(eq(turns.id, summaryTurnId)).run();
  const stepResult = db.insert(steps).values({ sessionId, turnId: summaryTurnId, stepIndex: 0, status: "completed", providerName: modelRef.split("/")[0] ?? "unknown", modelId: modelRef.split("/")[1] ?? "summarizer", finishReason: "stop", startedAt: now, completedAt: now, stepTimeMs: 0 }).returning({ id: steps.id }).get();
  const stepId = stepResult?.id;
  if (stepId) {
    db.insert(stepParts).values({ sessionId, turnId: summaryTurnId, stepId, type: "text", seq: 0, status: "completed", data: JSON.stringify({ content: summaryText }), createdAt: now }).run();
  }
  insertSubagentSpawn({
    parentSessionId: sessionId, parentTurnId: summaryTurnId, parentTurnNumber: summaryTurnNumber,
    parentStepId: stepId ?? null, parentStepIndex: 0, toolCallId: `summary-${summaryTurnId}`,
    childSessionId, childTurnId, childTurnNumber, kind: "spawn", taskLabel: childLabel,
  }, dataDir);

  return { summaryTurnId, summaryTurnNumber, startTurn, endTurn, summaryText, originalTokens, summaryTokens: usage?.totalTokens ?? 0, childSessionId };
}
