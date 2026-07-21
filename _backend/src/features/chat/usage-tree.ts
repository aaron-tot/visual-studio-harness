/**
 * Build session → turn → step → subagent usage trees for GET /api/sessions/:id/usage-tree.
 *
 * Inclusive rules:
 * - Session: own + Σ own of all descendant sessions (parentId tree)
 * - Turn: own + Σ own of each spawn edge's **child turn** (not full child lifetime)
 * - Step: own + linked child turn own
 *
 * Own token SoT remains step/turn columns; session own prefers cache, falls back to SUM(turns).
 */
import { eq, and, sum } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import {
  turns,
  turnContext,
  steps,
  sessions,
  subagentSpawns,
} from "../../db/schema";

export interface UsageTokenBlock {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface UsageTreeStep {
  stepIndex: number;
  status?: string;
  finishReason?: string;
  modelId?: string;
  providerName?: string;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  durationMs?: number;
  subagents?: UsageTreeSubagent[];
}

export interface UsageTreeTurn {
  turnId: number;
  turnNumber: number;
  userContentPreview?: string;
  modelName?: string;
  providerName?: string;
  agentName?: string;
  contextTurnNumbers: number[];
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  durationMs?: number;
  inclusiveDurationMs?: number;
  stepCount?: number;
  inclusiveStepCount?: number;
  status?: string;
  steps: UsageTreeStep[];
}

export interface UsageTreeSubagent {
  childSessionId: string;
  taskLabel?: string;
  kind: "spawn" | "resume";
  childTurnNumber?: number;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  child?: UsageTreeSession;
}

export interface UsageTreeSession {
  sessionId: string;
  label?: string;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  turnCount?: number;
  inclusiveTurnCount?: number;
  stepCount?: number;
  inclusiveStepCount?: number;
  durationMs?: number;
  inclusiveDurationMs?: number;
  turns: UsageTreeTurn[];
}

function emptyBlock(): UsageTokenBlock {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function ownBlock(t: {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): UsageTokenBlock {
  return {
    inputTokens: t.inputTokens ?? 0,
    outputTokens: t.outputTokens ?? 0,
    totalTokens: t.totalTokens ?? 0,
    reasoningTokens: t.reasoningTokens ?? undefined,
    cacheReadTokens: t.cacheReadTokens ?? undefined,
    cacheWriteTokens: t.cacheWriteTokens ?? undefined,
  };
}

function addBlocks(a: UsageTokenBlock, b: UsageTokenBlock): UsageTokenBlock {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  };
}

function sumBlocks(blocks: UsageTokenBlock[]): UsageTokenBlock {
  return blocks.reduce((acc, b) => addBlocks(acc, b), emptyBlock());
}

/** Prefer session cache; if empty/stale (0), SUM successful turns for this session. */
export function getSessionOwnTokens(
  sessionId: string,
  dataDir?: string,
): UsageTokenBlock {
  const db = getDbForDataDir(dataDir);
  const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!s) return emptyBlock();

  const cached = {
    inputTokens: s.cachedInputTokens ?? 0,
    outputTokens: s.cachedOutputTokens ?? 0,
    totalTokens: s.cachedTotalTokens ?? 0,
  };
  if (cached.totalTokens > 0 || cached.inputTokens > 0 || cached.outputTokens > 0) {
    return cached;
  }

  const row = db
    .select({
      inputTokens: sum(turns.inputTokens),
      outputTokens: sum(turns.outputTokens),
      totalTokens: sum(turns.totalTokens),
      reasoningTokens: sum(turns.reasoningTokens),
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .get();

  return {
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    reasoningTokens: Number(row?.reasoningTokens ?? 0) || undefined,
  };
}

function getSessionDurationMs(sessionId: string, dataDir?: string): number {
  const db = getDbForDataDir(dataDir);
  const rows = db
    .select({ durationMs: turns.durationMs })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all();
  return rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);
}

function getSessionTurnStepCounts(
  sessionId: string,
  dataDir?: string,
): { turns: number; steps: number } {
  const db = getDbForDataDir(dataDir);
  const turnN = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all().length;
  const stepN = db
    .select()
    .from(steps)
    .where(eq(steps.sessionId, sessionId))
    .all().length;
  return { turns: turnN, steps: stepN };
}

/**
 * @param path - sessions already on the recursion stack (cycle guard)
 */
export function buildUsageTree(
  sessionId: string,
  dataDir?: string,
  path: ReadonlySet<string> = new Set(),
): UsageTreeSession | null {
  if (path.has(sessionId)) return null;

  const db = getDbForDataDir(dataDir);
  const sessionRow = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!sessionRow) return null;

  const nextPath = new Set(path);
  nextPath.add(sessionId);

  const turnRows = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.turnNumber)
    .all();

  const stepRows = db
    .select()
    .from(steps)
    .where(eq(steps.sessionId, sessionId))
    .orderBy(steps.stepIndex)
    .all();

  const spawnRows = db
    .select()
    .from(subagentSpawns)
    .where(eq(subagentSpawns.parentSessionId, sessionId))
    .all();

  const turnsWithSteps: UsageTreeTurn[] = turnRows.map((t) => {
    const turnSteps = stepRows.filter((s) => s.turnId === t.id);
    const turnSpawns = spawnRows.filter((s) => s.parentTurnId === t.id);

    const ctxRows = db
      .select({ turnNumber: turns.turnNumber })
      .from(turnContext)
      .innerJoin(turns, eq(turns.id, turnContext.contextTurnId))
      .where(eq(turnContext.turnId, t.id))
      .orderBy(turnContext.position)
      .all();

    const stepViewModels: UsageTreeStep[] = turnSteps.map((s) => {
      const stepSpawns = turnSpawns.filter((sp) => sp.parentStepId === s.id);
      const own = ownBlock(s);

      const subagentViewModels: UsageTreeSubagent[] = stepSpawns.map((sp) => {
        const childOwn = getChildTurnOwn(
          sp.childSessionId,
          sp.childTurnNumber ?? undefined,
          dataDir,
        );
        const childTree = buildUsageTree(sp.childSessionId, dataDir, nextPath);
        return {
          childSessionId: sp.childSessionId,
          taskLabel: sp.taskLabel ?? undefined,
          kind: (sp.kind as "spawn" | "resume") || "spawn",
          childTurnNumber: sp.childTurnNumber ?? undefined,
          own: childOwn,
          inclusive: childTree ? childTree.inclusive : childOwn,
          child: childTree ?? undefined,
        };
      });

      const childOwns = subagentViewModels.map((sv) => sv.own);
      const inclusive = addBlocks(own, sumBlocks(childOwns));

      return {
        stepIndex: s.stepIndex,
        status: s.status,
        finishReason: s.finishReason ?? undefined,
        modelId: s.modelId ?? undefined,
        providerName: s.providerName ?? undefined,
        own,
        inclusive,
        durationMs: s.stepTimeMs ?? undefined,
        subagents:
          subagentViewModels.length > 0 ? subagentViewModels : undefined,
      };
    });

    const turnOwn = ownBlock(t);
    const edgeChildOwns = stepViewModels
      .flatMap((sv) => sv.subagents ?? [])
      .map((sa) => sa.own);
    const turnInclusive = addBlocks(turnOwn, sumBlocks(edgeChildOwns));

    let inclusiveStepCount = turnSteps.length;
    let inclusiveDurationMs = t.durationMs ?? 0;
    for (const sa of stepViewModels.flatMap((sv) => sv.subagents ?? [])) {
      if (sa.child) {
        inclusiveStepCount += sa.child.stepCount ?? 0;
        inclusiveDurationMs += sa.child.durationMs ?? 0;
      }
    }

    return {
      turnId: t.id,
      turnNumber: t.turnNumber,
      userContentPreview: t.userContent?.slice(0, 100),
      modelName: t.modelName ?? undefined,
      providerName: t.providerName ?? undefined,
      agentName: t.agentName ?? undefined,
      contextTurnNumbers: ctxRows.map((r) => r.turnNumber),
      own: turnOwn,
      inclusive: turnInclusive,
      durationMs: t.durationMs ?? undefined,
      inclusiveDurationMs:
        inclusiveDurationMs > (t.durationMs ?? 0)
          ? inclusiveDurationMs
          : t.durationMs ?? undefined,
      stepCount: t.stepCount ?? turnSteps.length,
      inclusiveStepCount,
      status: t.status,
      steps: stepViewModels,
    };
  });

  const sessionOwn = getSessionOwnTokens(sessionId, dataDir);
  const ownDuration = getSessionDurationMs(sessionId, dataDir);
  const ownCounts = getSessionTurnStepCounts(sessionId, dataDir);

  const descendantIds = collectDescendantSessions(sessionId, dataDir, nextPath);
  let inclTurns = ownCounts.turns;
  let inclSteps = ownCounts.steps;
  let inclDuration = ownDuration;
  let sessionInclusive = { ...sessionOwn };

  for (const dsId of descendantIds) {
    const dOwn = getSessionOwnTokens(dsId, dataDir);
    sessionInclusive = addBlocks(sessionInclusive, dOwn);
    const dc = getSessionTurnStepCounts(dsId, dataDir);
    inclTurns += dc.turns;
    inclSteps += dc.steps;
    inclDuration += getSessionDurationMs(dsId, dataDir);
  }

  return {
    sessionId,
    label: sessionRow.title ?? undefined,
    own: sessionOwn,
    inclusive: sessionInclusive,
    turnCount: ownCounts.turns,
    inclusiveTurnCount: inclTurns,
    stepCount: ownCounts.steps,
    inclusiveStepCount: inclSteps,
    durationMs: ownDuration > 0 ? ownDuration : undefined,
    inclusiveDurationMs:
      inclDuration > ownDuration ? inclDuration : ownDuration > 0 ? ownDuration : undefined,
    turns: turnsWithSteps,
  };
}

function getChildTurnOwn(
  childSessionId: string,
  childTurnNumber: number | undefined,
  dataDir?: string,
): UsageTokenBlock {
  const db = getDbForDataDir(dataDir);
  if (childTurnNumber != null) {
    const t = db
      .select()
      .from(turns)
      .where(
        and(
          eq(turns.sessionId, childSessionId),
          eq(turns.turnNumber, childTurnNumber),
        ),
      )
      .get();
    if (t) return ownBlock(t);
  }
  // Fallback: latest turn own, else session own
  const latest = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, childSessionId))
    .orderBy(turns.turnNumber)
    .all()
    .at(-1);
  if (latest) return ownBlock(latest);
  return getSessionOwnTokens(childSessionId, dataDir);
}

/**
 * All session ids under parentId (recursive).
 * `visited` = nodes already on the walk path (cycle guard only) — parentId itself
 * is marked so we do not re-enter it via a parentId loop, but we still enumerate its children.
 */
function collectDescendantSessions(
  parentId: string,
  dataDir?: string,
  visited: ReadonlySet<string> = new Set(),
): string[] {
  const db = getDbForDataDir(dataDir);
  const children = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.parentId, parentId))
    .all();
  const result: string[] = [];
  const next = new Set(visited);
  next.add(parentId);
  for (const c of children) {
    if (next.has(c.id)) continue; // cycle: child already on path
    result.push(c.id);
    result.push(...collectDescendantSessions(c.id, dataDir, next));
  }
  return result;
}
