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
import { and, eq, desc, lt } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, stepParts } from "../../db/schema";
import { getSessionModelConfigJson } from "../sessions/db";
import {
  getNextTurnNumber,
  createStep,
  insertStepPart,
} from "./db-trace";
import {
  getLatestSummaryRangeBefore,
  insertSummaryRange,
} from "../sessions/db";
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

export function isSessionCompacting(sessionId: string): boolean {
  return compactingSessions.has(sessionId);
}

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

  // Reconstruct the covered turns (user + assistant text, excluding summaries).
  const chatMessages = projectSessionChat(sessionId, dataDir) as unknown as {
    turnId: number | null; isSummary?: boolean; role: string; content: string;
  }[];
  const rangeTurns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of chatMessages) {
    if (m.isSummary) continue;
    const tn = m.turnId;
    if (tn == null || tn < startTurn || tn > endTurnNum) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (!m.content) continue;
    rangeTurns.push({ role: m.role as "user" | "assistant", content: m.content });
  }
  if (rangeTurns.length === 0) return;

  // Prior chain summary text (chaining).
  let priorSummary: string | null = null;
  if (cfg.summarizeIncludePriorSummary && prior) {
    priorSummary = readSummaryText(dataDir, prior.summaryTurnId);
  }
  const messages = buildSummarizationMessages(priorSummary, rangeTurns);

  if (!cfg.modelRef) {
    console.error("[auto-compaction] no summarization model configured; skipping");
    return;
  }
  if (!/^[^/]+\/[^/]+$/.test(cfg.modelRef)) {
    console.error("[auto-compaction] invalid model ref; skipping");
    return;
  }

  // Run the summarizer.
  let result: { text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number } | null };
  try {
    result = await runSummarizer(dataDir, {
      promptMd: cfg.promptMd,
      modelRef: cfg.modelRef,
      fallbackModelRef: cfg.fallbackModelRef,
      messages,
      sessionId,
      workspaceRoot,
    });
  } catch (err) {
    console.error("[auto-compaction] summarize failed:", err);
    return;
  }
  const summaryText = (result.text ?? "").trim();
  if (!summaryText) return;

  // Create the summary turn (kind='summary') in the main session with a text part.
  const summaryTurnNumber = getNextTurnNumber(sessionId, dataDir);
  const summaryMeta = {
    kind: "summary",
    promptMd: cfg.promptMd ?? null,
    model: cfg.modelRef,
    provider: cfg.modelRef.split("/")[0] ?? null,
    range: { startTurn, endTurn: endTurnNum },
    prevRangeId: prior?.id ?? null,
    originalTokens: 0,
    summaryTokens: result.usage?.totalTokens ?? 0,
    initiatedAt: now,
    initiator: "auto",
    childSessionId: null,
    childTurnNumber: null,
  };
  const promptContent = (await readSummarizationPrompt(cfg.promptMd)) ?? `Summarize conversation turns ${startTurn}–${endTurnNum}`;
  const originalTokens = db
    .select({ n: turns.turnNumber, t: turns.totalTokens })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
    .all()
    .filter((r) => r.n >= startTurn && r.n <= endTurnNum)
    .reduce((s, r) => s + (r.t ?? 0), 0);

  const summaryTurnId = db
    .insert(turns)
    .values({
      sessionId,
      turnNumber: summaryTurnNumber,
      userContent: promptContent,
      userTimestamp: now,
      status: "success",
      success: true,
      providerName: cfg.modelRef.split("/")[0] ?? "unknown",
      modelName: cfg.modelRef.split("/")[1] ?? "summarizer",
      finishReason: "stop",
      startedAt: now,
      completedAt: now,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      reasoningTokens: (result.usage as { reasoningTokens?: number } | undefined)?.reasoningTokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stepCount: 1,
      kind: "summary",
      configSnapshotJson: JSON.stringify(summaryMeta),
    })
    .returning({ id: turns.id })
    .get();
  if (!summaryTurnId) return;

  // Text step part (message-builder reads this to inject).
  const stepId = createStep(summaryTurnId!.id, sessionId, 0, {
    providerName: cfg.modelRef.split("/")[0],
    modelId: cfg.modelRef.split("/")[1] ?? "summarizer",
  }, dataDir);
  insertStepPart(sessionId, summaryTurnId!.id, stepId, "text", { content: summaryText }, 0, "completed", {}, dataDir);
  db.update(stepParts)
    .set({ status: "completed" })
    .where(eq(stepParts.turnId, summaryTurnId!.id))
    .run();
  db.update(turns)
    .set({ configSnapshotJson: JSON.stringify({ ...summaryMeta, summaryTokens: result.usage?.totalTokens ?? 0 }) })
    .where(eq(turns.id, summaryTurnId!.id))
    .run();

  insertSummaryRange(dataDir, {
    sessionId,
    summaryTurnId: summaryTurnId!.id,
    startTurn,
    endTurn: endTurnNum,
    prevRangeId: prior?.id ?? null,
    originalTokens,
    summaryTokens: result.usage?.totalTokens ?? 0,
    createdAt: now,
  });

  // Pin context to the new summary: first live turn after the summary turn.
  const firstLiveAfterSummary = summaryTurnNumber + 1;
  try {
    const raw = getSessionModelConfigJson(sessionId, dataDir);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.context = { ...(parsed.context ?? {}), mode: "fixed", pinnedTurn: firstLiveAfterSummary, enabled: true };
    // Persist through the same storage path used elsewhere.
    const { setSessionModelConfigJson } = await import("../sessions/db");
    setSessionModelConfigJson(sessionId, JSON.stringify(parsed), dataDir);
  } catch (err) {
    console.error("[auto-compaction] could not pin context:", err);
  }

  console.error(
    `[auto-compaction] ok session=${sessionId} range=${startTurn}–${endTurnNum} summaryTurn=${summaryTurnNumber} pinnedTurn=${firstLiveAfterSummary}`,
  );
}
