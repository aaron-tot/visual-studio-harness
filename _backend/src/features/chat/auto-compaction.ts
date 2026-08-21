/**
 * Auto compaction (v2): when the current context is at/above a configured
 * token threshold, the session is pending. The next runTurn (user send /
 * auto-continue) compact first — (a) summarize the currently in-context turns
 * into a new summary turn and (b) pin the session to that summary — then
 * persist and stream the new user message. The new message is never included
 * in the summary.
 *
 * "Current context" = the LAST STEP's provider-reported input + cache-read
 * token count for the last live (`kind === "turn"`, success) turn. Use the
 * step, NOT the turn: `turns.input_tokens` is the SUM across every step of
 * that turn (cost figure). An agentic turn re-sends the whole growing context
 * once per step, so summing massively over-counts the real context window.
 * The latest step is always the actual current context.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, desc } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, stepParts, steps } from "../../db/schema";
import {
  getSessionModelConfigJson,
  setSessionModelConfigJson,
  getLatestSummaryRange,
  getLatestSummaryRangeBefore,
} from "../sessions/db";
import { projectSessionChat } from "./project-chat";
import { readSummarizationPrompt } from "../sessions/summarizer";
import { runSummaryBlock, type BlockSummaryResult } from "../sessions/summarize-block";
import { resolveSummarizerContextLimit, perBlockBudget, planChunks, extractPriorTurns } from "../sessions/summary-blocks";
import { sendSessionStateToSession, sendToSession } from "../sessions/view-tracker";
import type { ContextScopeConfig } from "./context-window";

/** Sessions currently performing an auto compaction (avoids double-firing). */
const compactingSessions = new Set<string>();

/** Default fraction of the summarizer's context reserved as headroom. */
const DEFAULT_SAFETY_MARGIN = 0.2;

function clampMargin(m: number): number {
  if (typeof m !== "number" || !Number.isFinite(m)) return DEFAULT_SAFETY_MARGIN;
  return Math.min(0.9, Math.max(0, m));
}

export function isPendingAutoCompaction(args: {
  enabled: boolean;
  triggerTokens: number;
  lastInputTokens: number;
  lastTurnNumber: number;
  latestSummaryEndTurn: number | null;
}): boolean {
  if (!args.enabled || args.triggerTokens <= 0) return false;
  if (args.lastInputTokens < args.triggerTokens) return false;
  if (args.latestSummaryEndTurn != null && args.latestSummaryEndTurn >= args.lastTurnNumber) return false;
  return true;
}

/**
 * Split a "Provider/Model" ref on the FIRST slash only, so a provider whose
 * model ids contain slashes (OpenRouter vendor/model, e.g.
 * "Openrouter/deepseek/deepseek-v4-flash-0731") is still valid. Both halves
 * must be non-empty. Mirrors splitModelRef in sessions/summarizer.ts.
 */
export function validModelRefParts(ref?: string | null): { providerName: string; modelName: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) return null;
  return { providerName: ref.slice(0, idx), modelName: ref.slice(idx + 1) };
}

/**
 * Thrown when a required (pending) auto-compaction fails. Propagates out of
 * runTurn before the user's turn is created, so the send is blocked and the
 * user message is not consumed — the user can simply retry.
 */
export class AutoCompactionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoCompactionBlockedError";
  }
}

function emitCompacting(sessionId: string, active: boolean) {
  try { sendToSession(sessionId, { type: "compacting", sessionId, active }); } catch { /* ignore */ }
}

interface EffectiveAutoConfig {
  enabled: boolean;
  triggerTokens: number;
  modelRef: string | null;
  fallbackModelRef: string | null;
  promptMd: string | null;
  summarizeIncludePriorSummary: boolean;
  /** Fraction of the summarizer's max context reserved as headroom (0..1). */
  safetyMargin: number;
  /** How many raw turns immediately before the summary range to feed in (>=0). */
  priorTurns: number;
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

  const val = <T>(key: "autoCompactionEnabled" | "autoCompactionTriggerTokens" | "summarizationModel" | "summarizationFallbackModel" | "summarizationPromptMd" | "summarizeIncludePriorSummary" | "summarizationSafetyMargin" | "summarizationPriorTurns"): T | undefined => {
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
    safetyMargin: clampMargin(val<number>("summarizationSafetyMargin") ?? DEFAULT_SAFETY_MARGIN),
    priorTurns: Math.max(0, Math.floor(val<number>("summarizationPriorTurns") ?? 0)),
  };
}

/**
 * The current context is the LAST STEP's provider-reported input token count
 * for the last live (`kind === "turn"`, success) turn. Always the latest
 * step — never the turn aggregate: `turns.input_tokens` is summed across all
 * steps of the turn (a cost figure), and an agentic turn re-sends the whole
 * growing context once per step, so the aggregate massively over-counts the
 * actual context window.
 *
 * `input_tokens` already includes the cached portion (OpenAI-compatible usage:
 * `prompt_tokens` is the whole prompt; `prompt_tokens_details.cached_tokens`
 * is a sub-slice). Cached + non-cached both occupy the context window, so the
 * context size is `inputTokens` alone — never `inputTokens + cacheReadTokens`,
 * which double-counts the cached portion.
 *
 * Returns the live turn's latest step usage (or null when there is no live
 * turn or it has no steps yet).
 */
function readLastLiveContextUsage(
  db: ReturnType<typeof getDbForDataDir>,
  sessionId: string,
): { turnNumber: number; used: number } | null {
  const lastLive = db
    .select({ id: turns.id, turnNumber: turns.turnNumber })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn"), eq(turns.success, true)))
    .orderBy(desc(turns.turnNumber))
    .limit(1)
    .get();
  if (!lastLive) return null;

  const lastStep = db
    .select({ inputTokens: steps.inputTokens })
    .from(steps)
    .where(eq(steps.turnId, lastLive.id))
    .orderBy(desc(steps.id))
    .limit(1)
    .get();
  if (!lastStep) return null;

  return {
    turnNumber: lastLive.turnNumber,
    used: lastStep.inputTokens ?? 0,
  };
}

/**
 * Last live turn's latest-step context token size against the effective
 * auto-compaction threshold. Used to seed the header context indicator on
 * session load/navigation (not just while a turn streams). Returns null when
 * auto compaction is off/unset or there is no completed live turn yet.
 */
export function getLastContextTokenUsage(
  dataDir: string,
  sessionId: string,
  workspaceRoot?: string,
): { used: number; max: number; pending: boolean } | null {
  const cfg = resolveEffectiveAutoConfig(sessionId, dataDir, workspaceRoot);
  if (!cfg.enabled || !cfg.triggerTokens || cfg.triggerTokens <= 0) return null;

  const db = getDbForDataDir(dataDir);
  const lastLive = readLastLiveContextUsage(db, sessionId);
  if (!lastLive) return null;

  const used = lastLive.used;
  const latest = getLatestSummaryRange(dataDir, sessionId);
  return {
    used,
    max: cfg.triggerTokens,
    pending: isPendingAutoCompaction({
      enabled: cfg.enabled,
      triggerTokens: cfg.triggerTokens,
      lastInputTokens: used,
      lastTurnNumber: lastLive.turnNumber,
      latestSummaryEndTurn: latest?.endTurn ?? null,
    }),
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
 * Trigger entry point, called at the start of the next runTurn when the
 * session is already at/above the threshold. Returns true if a compaction ran.
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
  const lastLive = readLastLiveContextUsage(db, sessionId);
  if (!lastLive) return false;

  const lastInputTokens = lastLive.used;
  const latest = getLatestSummaryRange(dataDir, sessionId);
  if (!isPendingAutoCompaction({
    enabled: cfg.enabled,
    triggerTokens: cfg.triggerTokens,
    lastInputTokens,
    lastTurnNumber: lastLive.turnNumber,
    latestSummaryEndTurn: latest?.endTurn ?? null,
  })) return false;

  compactingSessions.add(sessionId);
  emitCompacting(sessionId, true);
  try {
    console.error(`[auto-compaction] session=${sessionId} inputTokens=${lastInputTokens} threshold=${cfg.triggerTokens} → compacting before next message`);
    await performAutoCompaction(sessionId, dataDir, workspaceRoot, cfg, lastLive.turnNumber);
    try {
      sendToSession(sessionId, {
        type: "context_tokens",
        sessionId,
        used: lastInputTokens,
        max: cfg.triggerTokens,
        pending: false,
      });
    } catch { /* ignore */ }
    return true;
  } finally {
    compactingSessions.delete(sessionId);
    emitCompacting(sessionId, false);
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

  // Range to compact: from after the prior summary (or turn 1) through endTurnNum.
  const prior = getLatestSummaryRangeBefore(dataDir, sessionId, endTurnNum);
  const startTurn = prior ? prior.endTurn + 1 : 1;
  if (startTurn > endTurnNum) return;

  // Reconstruct the covered turns (user + assistant text, excluding summaries),
  // grouped by conversation turn for both the summarizer input and child clone.
  const chatMessages = projectSessionChat(sessionId, dataDir) as unknown as {
    turnId: number | null; isSummary?: boolean; role: string; content: string;
  }[];
  const groups: { turnId: number; userContent: string; assistantContents: string[] }[] = [];
  {
    let cur: { turnId: number; userContent: string; assistantContents: string[] } | null = null;
    for (const m of chatMessages) {
      if (m.isSummary) continue;
      const tn = m.turnId;
      if (tn == null || tn < startTurn || tn > endTurnNum) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (!m.content) continue;
      if (m.role === "user") {
        if (cur) groups.push(cur);
        cur = { turnId: tn, userContent: m.content, assistantContents: [] };
      } else if (m.role === "assistant") {
        if (!cur) cur = { turnId: tn, userContent: "", assistantContents: [] };
        cur.assistantContents.push(m.content);
      }
    }
    if (cur) groups.push(cur);
  }
  if (groups.length === 0) return;

  const promptContent = (await readSummarizationPrompt(cfg.promptMd)) ?? `Summarize conversation turns ${startTurn}–${endTurnNum}`;

  // Prior chain summary text (always chained — R6: the toggle does not gate
  // block continuity). Cloned into the first child for continuity view.
  const priorSummary: string | null = prior ? readSummaryText(dataDir, prior.summaryTurnId) : null;
  let priorCloneGroup: { userContent: string; assistantContents: string[] } | null = null;
  if (prior && priorSummary) {
    const priorTurn = db
      .select({ userContent: turns.userContent })
      .from(turns)
      .where(eq(turns.id, prior.summaryTurnId))
      .get();
    priorCloneGroup = priorTurn?.userContent
      ? { userContent: priorTurn.userContent, assistantContents: [priorSummary] }
      : null;
  }

  // Raw turns immediately preceding the summary range (recent history fed in
  // addition to the prior summary). Read-only; only when a prior range exists.
  const priorCtx = extractPriorTurns(chatMessages, prior?.endTurn ?? null, cfg.priorTurns);

  // Resolve the SUMMARIZER's own max context (R1/R10). Fail loudly when unknown.
  const maxContext = await resolveSummarizerContextLimit({
    modelRef: cfg.modelRef ?? "",
    fallbackModelRef: cfg.fallbackModelRef,
    dataDir,
  });
  if (maxContext == null) {
    throw new AutoCompactionBlockedError(
      `auto-compaction: cannot resolve summarizer context limit for "${cfg.modelRef}"; compaction blocked`,
    );
  }
  const budget = perBlockBudget(maxContext, cfg.safetyMargin);

  // Planner input: one unit per turn (user + assistant joined) so block
  // boundaries never split a single turn.
  const plannerInput = groups.map((g) => ({
    role: "user" as const,
    content: [g.userContent, ...g.assistantContents].filter(Boolean).join("\n"),
  }));
  let boundaries;
  try {
    boundaries = planChunks({ turns: plannerInput, prioritySummary: priorSummary, prompt: promptContent, budget, priorTurns: priorCtx.turns });
  } catch (err) {
    throw new AutoCompactionBlockedError(`auto-compaction: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.error(
    `[auto-compaction] session=${sessionId} range=${startTurn}–${endTurnNum} budget=${budget} blocks=${boundaries.length}`,
  );

  // Execute blocks oldest-first, chaining prior summaries + prevRangeId.
  let prevRangeId: number | null = prior?.id ?? null;
  let runningPriorSummary: string | null = priorSummary;
  let runningPriorCloneGroup = priorCloneGroup;
  let lastGood: BlockSummaryResult | null = null;

  try {
    for (const b of boundaries) {
      const slice = groups.slice(b.startIndex, b.endIndex + 1);
      if (slice.length === 0) continue;
      const blockStartTurn = slice[0].turnId;
      const blockEndTurn = slice[slice.length - 1].turnId;
      const blockTurns: { role: "user" | "assistant"; content: string }[] = [];
      for (const g of slice) {
        blockTurns.push({ role: "user", content: g.userContent });
        for (const a of g.assistantContents) blockTurns.push({ role: "assistant", content: a });
      }

      const result = await runSummaryBlock({
        dataDir, sessionId, workspaceRoot,
        startTurn: blockStartTurn, endTurn: blockEndTurn,
        rangeTurns: blockTurns,
        rangeGroups: slice.map((g) => ({ userContent: g.userContent, assistantContents: g.assistantContents })),
        priorTurns: priorCtx.turns,
        priorTurnGroups: priorCtx.groups,
        priorSummary: runningPriorSummary,
        priorCloneGroup: runningPriorCloneGroup,
        prevRangeId,
        modelRef: cfg.modelRef,
        fallbackModelRef: cfg.fallbackModelRef,
        promptMd: cfg.promptMd,
        initiator: "auto",
      });
      lastGood = result;
      prevRangeId = result.rangeId;
      runningPriorSummary = result.summaryText;
      runningPriorCloneGroup = { userContent: promptContent, assistantContents: [result.summaryText] };
    }
  } catch (err) {
    // Partial success: pin to the last good block; keep the send blocked (R7/R8).
    if (lastGood) pinContextTo(sessionId, dataDir, lastGood.summaryTurnNumber);
    throw new AutoCompactionBlockedError(
      `auto-compaction: summarize failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Full success: pin to the final block's summary turn.
  if (lastGood) {
    pinContextTo(sessionId, dataDir, lastGood.summaryTurnNumber);
  }
  console.error(
    `[auto-compaction] ok session=${sessionId} range=${startTurn}–${endTurnNum} blocks=${boundaries.length} summaryTurn=${lastGood?.summaryTurnNumber ?? null}`,
  );
}

/** Pin the session context to a summary turn (fixed mode). */
function pinContextTo(sessionId: string, dataDir: string, pinnedTurn: number): void {
  try {
    const raw = getSessionModelConfigJson(sessionId, dataDir);
    const parsed = raw ? JSON.parse(raw) : {};
    // Only the user's "Use custom settings" toggle may change context.enabled —
    // never auto-enable the session override here (preserve the existing flag).
    parsed.context = { ...(parsed.context ?? {}), mode: "fixed", pinnedTurn };
    setSessionModelConfigJson(sessionId, JSON.stringify(parsed), dataDir);
  } catch (err) {
    console.error("[auto-compaction] could not pin context:", err);
  }
}
