/**
 * Build session → turn → step → subagent usage trees for GET /api/sessions/:id/usage-tree.
 *
 * Inclusive rules:
 * - Session: own + Σ own of all descendant sessions (parentId tree)
 * - Turn: own + Σ own of each spawn edge's **child turn** (not full child lifetime)
 * - Step: own + linked child turn own
 *
 * Own token SoT remains step/turn columns; session own prefers cache, falls back to SUM(turns).
 *
 * Lazy loading (§3): the top-level `buildUsageTree` returns a **shallow** payload —
 * session aggregates + turn summaries with `steps: []`. Step payloads (usage/timing
 * columns only, never raw_request_json / raw_response_json) load via
 * `buildTurnStepsTree` when the user expands a turn. Child subagent trees are only
 * fetched on demand (shallow, same shape) when a spawn stub is expanded.
 */
import { eq, and, desc } from "drizzle-orm";
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
  costUsd?: number;
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
  steps?: UsageTreeStep[];
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
  costUsd?: number | null;
}): UsageTokenBlock {
  return {
    inputTokens: t.inputTokens ?? 0,
    outputTokens: t.outputTokens ?? 0,
    totalTokens: t.totalTokens ?? 0,
    reasoningTokens: t.reasoningTokens ?? undefined,
    cacheReadTokens: t.cacheReadTokens ?? undefined,
    cacheWriteTokens: t.cacheWriteTokens ?? undefined,
    costUsd: t.costUsd ?? undefined,
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
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) || undefined,
  };
}

function sumBlocks(blocks: UsageTokenBlock[]): UsageTokenBlock {
  return blocks.reduce((acc, b) => addBlocks(acc, b), emptyBlock());
}

// ── Narrow column projections (never read raw_request_json / raw_response_json) ──
const turnCols = {
  id: turns.id,
  sessionId: turns.sessionId,
  turnNumber: turns.turnNumber,
  userContent: turns.userContent,
  status: turns.status,
  modelName: turns.modelName,
  providerName: turns.providerName,
  agentName: turns.agentName,
  durationMs: turns.durationMs,
  inputTokens: turns.inputTokens,
  outputTokens: turns.outputTokens,
  totalTokens: turns.totalTokens,
  reasoningTokens: turns.reasoningTokens,
  cacheReadTokens: turns.cacheReadTokens,
  cacheWriteTokens: turns.cacheWriteTokens,
  costUsd: turns.costUsd,
  stepCount: turns.stepCount,
};

const stepCols = {
  id: steps.id,
  turnId: steps.turnId,
  sessionId: steps.sessionId,
  stepIndex: steps.stepIndex,
  status: steps.status,
  providerName: steps.providerName,
  modelId: steps.modelId,
  finishReason: steps.finishReason,
  inputTokens: steps.inputTokens,
  outputTokens: steps.outputTokens,
  totalTokens: steps.totalTokens,
  reasoningTokens: steps.reasoningTokens,
  cacheReadTokens: steps.cacheReadTokens,
  cacheWriteTokens: steps.cacheWriteTokens,
  noCacheInputTokens: steps.noCacheInputTokens,
  stepTimeMs: steps.stepTimeMs,
  costUsd: steps.costUsd,
};

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
    // Cached aggregate lacks cache-read columns; fetch them from turns sum.
    const cr = db
      .select({
        cacheReadTokens: turns.cacheReadTokens,
        cacheWriteTokens: turns.cacheWriteTokens,
        costUsd: turns.costUsd,
      })
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .all()
      .reduce(
        (acc, r) => ({
          cacheReadTokens: (acc.cacheReadTokens ?? 0) + (r.cacheReadTokens ?? 0),
          cacheWriteTokens: (acc.cacheWriteTokens ?? 0) + (r.cacheWriteTokens ?? 0),
          costUsd: (acc.costUsd ?? 0) + (r.costUsd ?? 0),
        }),
        { cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      );
    return {
      ...cached,
      cacheReadTokens: cr.cacheReadTokens || undefined,
      cacheWriteTokens: cr.cacheWriteTokens || undefined,
      costUsd: cr.costUsd || undefined,
    };
  }

  const rows = db
    .select({
      inputTokens: turns.inputTokens,
      outputTokens: turns.outputTokens,
      totalTokens: turns.totalTokens,
      reasoningTokens: turns.reasoningTokens,
      cacheReadTokens: turns.cacheReadTokens,
      cacheWriteTokens: turns.cacheWriteTokens,
      costUsd: turns.costUsd,
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all();

  const acc = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  for (const r of rows) {
    acc.inputTokens += r.inputTokens ?? 0;
    acc.outputTokens += r.outputTokens ?? 0;
    acc.totalTokens += r.totalTokens ?? 0;
    acc.reasoningTokens += r.reasoningTokens ?? 0;
    acc.cacheReadTokens += r.cacheReadTokens ?? 0;
    acc.cacheWriteTokens += r.cacheWriteTokens ?? 0;
    acc.costUsd += r.costUsd ?? 0;
  }

  return {
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    totalTokens: acc.totalTokens,
    reasoningTokens: acc.reasoningTokens || undefined,
    cacheReadTokens: acc.cacheReadTokens || undefined,
    cacheWriteTokens: acc.cacheWriteTokens || undefined,
    costUsd: acc.costUsd || undefined,
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

/** Cheap COUNT(*) of turns and steps for a session (no blob reads). */
function getSessionTurnStepCounts(
  sessionId: string,
  dataDir?: string,
): { turns: number; steps: number } {
  const db = getDbForDataDir(dataDir);
  const turnN = db
    .select({ n: turns.id })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all().length;
  const stepN = db
    .select({ n: steps.id })
    .from(steps)
    .where(eq(steps.sessionId, sessionId))
    .all().length;
  return { turns: turnN, steps: stepN };
}

/** Own token block for a specific child turn, or fall back to latest turn / session own. */
function getChildTurnOwn(
  childSessionId: string,
  childTurnNumber: number | undefined,
  dataDir?: string,
): UsageTokenBlock {
  const db = getDbForDataDir(dataDir);
  const cols = {
    inputTokens: turns.inputTokens,
    outputTokens: turns.outputTokens,
    totalTokens: turns.totalTokens,
    reasoningTokens: turns.reasoningTokens,
    cacheReadTokens: turns.cacheReadTokens,
    cacheWriteTokens: turns.cacheWriteTokens,
    costUsd: turns.costUsd,
  };
  if (childTurnNumber != null) {
    const t = db
      .select(cols)
      .from(turns)
      .where(
        and(eq(turns.sessionId, childSessionId), eq(turns.turnNumber, childTurnNumber)),
      )
      .get();
    if (t) return ownBlock(t);
  }
  const latest = db
    .select(cols)
    .from(turns)
    .where(eq(turns.sessionId, childSessionId))
    .orderBy(desc(turns.turnNumber))
    .limit(1)
    .get();
  if (latest) return ownBlock(latest);
  return getSessionOwnTokens(childSessionId, dataDir);
}

/** Child turn step-count / duration (child turn columns only — no child recursion). */
function getChildTurnSummary(
  childSessionId: string,
  childTurnNumber: number | undefined,
  dataDir?: string,
): { stepCount: number; durationMs: number } | null {
  const db = getDbForDataDir(dataDir);
  const cols = {
    stepCount: turns.stepCount,
    durationMs: turns.durationMs,
  };
  const t = childTurnNumber != null
    ? db
        .select(cols)
        .from(turns)
        .where(
          and(eq(turns.sessionId, childSessionId), eq(turns.turnNumber, childTurnNumber)),
        )
        .get()
    : db
        .select(cols)
        .from(turns)
        .where(eq(turns.sessionId, childSessionId))
        .orderBy(desc(turns.turnNumber))
        .limit(1)
        .get();
  if (!t) return null;
  return { stepCount: t.stepCount ?? 0, durationMs: t.durationMs ?? 0 };
}

function contextTurnNumbers(sessionId: string, turnId: number, dataDir?: string): number[] {
  const db = getDbForDataDir(dataDir);
  const rows = db
    .select({ turnNumber: turns.turnNumber })
    .from(turnContext)
    .innerJoin(turns, eq(turns.id, turnContext.contextTurnId))
    .where(eq(turnContext.turnId, turnId))
    .orderBy(turnContext.position)
    .all();
  return rows.map((r) => r.turnNumber);
}

/** Step-count per turn for a session, via one GROUP BY query (no blob reads). */
function stepCountsByTurn(sessionId: string, dataDir?: string): Map<number, number> {
  const db = getDbForDataDir(dataDir);
  const rows = db
    .select({ turnId: steps.turnId, n: steps.id })
    .from(steps)
    .where(eq(steps.sessionId, sessionId))
    .all();
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.turnId, (map.get(r.turnId) ?? 0) + 1);
  return map;
}

interface TurnRowLike {
  id: number;
  turnNumber: number;
  userContent: string | null;
  status: string | null;
  modelName: string | null;
  providerName: string | null;
  agentName: string | null;
  durationMs: number | null;
  stepCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}

/**
 * Shared turn view-model builder.
 * `steps` are included when `stepViewModels` is provided; otherwise `steps: []`
 * (shallow). Inclusive uses spawn-edge child turn columns only — never recurses
 * into the child session's own turn list.
 */
function turnViewModel(
  t: TurnRowLike,
  sessionId: string,
  spawnsForTurn: { childSessionId: string; childTurnNumber: number | null }[],
  stepViewModels: UsageTreeStep[] | undefined,
  dataDir?: string,
): UsageTreeTurn {
  const turnOwn = ownBlock(t);
  const edgeChildren = spawnsForTurn.map((sp) =>
    getChildTurnOwn(sp.childSessionId, sp.childTurnNumber ?? undefined, dataDir),
  );
  const turnInclusive = addBlocks(turnOwn, sumBlocks(edgeChildren));

  let inclStep = t.stepCount ?? 0;
  let inclDur = t.durationMs ?? 0;
  for (const sp of spawnsForTurn) {
    const cs = getChildTurnSummary(sp.childSessionId, sp.childTurnNumber ?? undefined, dataDir);
    if (cs) {
      inclStep += cs.stepCount;
      inclDur += cs.durationMs;
    }
  }

  return {
    turnId: t.id,
    turnNumber: t.turnNumber,
    userContentPreview: t.userContent?.slice(0, 100),
    modelName: t.modelName ?? undefined,
    providerName: t.providerName ?? undefined,
    agentName: t.agentName ?? undefined,
    contextTurnNumbers: contextTurnNumbers(sessionId, t.id, dataDir),
    own: turnOwn,
    inclusive: turnInclusive,
    durationMs: t.durationMs ?? undefined,
    inclusiveDurationMs:
      inclDur > (t.durationMs ?? 0) ? inclDur : t.durationMs ?? undefined,
    stepCount: t.stepCount ?? stepViewModels?.length ?? 0,
    inclusiveStepCount: inclStep || undefined,
    status: t.status ?? undefined,
    steps: stepViewModels ?? [],
  };
}

function buildSpawnStub(
  sp: {
    childSessionId: string;
    taskLabel: string | null;
    kind: string;
    childTurnNumber: number | null;
  },
  dataDir?: string,
): UsageTreeSubagent {
  const childOwn = getChildTurnOwn(
    sp.childSessionId,
    sp.childTurnNumber ?? undefined,
    dataDir,
  );
  return {
    childSessionId: sp.childSessionId,
    taskLabel: sp.taskLabel ?? undefined,
    kind: (sp.kind as "spawn" | "resume") || "spawn",
    childTurnNumber: sp.childTurnNumber ?? undefined,
    own: childOwn,
    inclusive: childOwn,
    child: undefined,
  };
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
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!sessionRow) return null;

  const nextPath = new Set(path);
  nextPath.add(sessionId);

  const turnRows = (db
    .select(turnCols)
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.turnNumber)
    .all()) as unknown as TurnRowLike[];

  const spawnRows = db
    .select()
    .from(subagentSpawns)
    .where(eq(subagentSpawns.parentSessionId, sessionId))
    .all();

  const stepCounts = stepCountsByTurn(sessionId, dataDir);

  const turnsWithSteps: UsageTreeTurn[] = turnRows.map((t) => {
    const turnSpawns = spawnRows
      .filter((s) => s.parentTurnId === t.id)
      .map((s) => ({
        childSessionId: s.childSessionId,
        childTurnNumber: s.childTurnNumber,
      }));
    // Shallow: steps omitted (arrive on expand). stepCount falls back to DB count.
    const vm = turnViewModel(t, sessionId, turnSpawns, undefined, dataDir);
    if (vm.stepCount == null || vm.stepCount === 0) {
      vm.stepCount = stepCounts.get(t.id) ?? 0;
    }
    return vm;
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

/**
 * Steps for one turn (usage/timing/model columns only — never raw_request_json /
 * raw_response_json). Each step lists its spawn stubs with `child` unset; the
 * child session's own tree is fetched lazily on expand.
 */
export function buildTurnStepsTree(
  sessionId: string,
  turnNumber: number,
  dataDir?: string,
): UsageTreeTurn | null {
  const db = getDbForDataDir(dataDir);
  const t = (db
    .select(turnCols)
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.turnNumber, turnNumber)))
    .get()) as unknown as TurnRowLike | null;
  if (!t) return null;

  const stepRows = (db
    .select(stepCols)
    .from(steps)
    .where(and(eq(steps.sessionId, sessionId), eq(steps.turnId, t.id)))
    .orderBy(steps.stepIndex)
    .all()) as unknown as {
    id: number;
    turnId: number;
    sessionId: string;
    stepIndex: number;
    status: string | null;
    providerName: string | null;
    modelId: string | null;
    finishReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    reasoningTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    stepTimeMs: number | null;
    costUsd: number | null;
  }[];

  const spawnRows = db
    .select()
    .from(subagentSpawns)
    .where(and(eq(subagentSpawns.parentSessionId, sessionId), eq(subagentSpawns.parentTurnId, t.id)))
    .all();

  const stepViewModels: UsageTreeStep[] = stepRows.map((s) => {
    const stepSpawns = spawnRows.filter((sp) => sp.parentStepId === s.id);
    const subagents = stepSpawns.map((sp) => buildSpawnStub(sp, dataDir));
    const own = ownBlock(s);
    const inclusive = addBlocks(own, sumBlocks(subagents.map((sa) => sa.own)));
    return {
      stepIndex: s.stepIndex,
      status: s.status ?? undefined,
      finishReason: s.finishReason ?? undefined,
      modelId: s.modelId ?? undefined,
      providerName: s.providerName ?? undefined,
      own,
      inclusive,
      durationMs: s.stepTimeMs ?? undefined,
      subagents: subagents.length > 0 ? subagents : undefined,
    };
  });

  const closable = spawnRows as (typeof spawnRows[number] & { childSessionId: string; childTurnNumber: number | null })[];
  const turnSpawns = closable.map((sp) => ({
    childSessionId: sp.childSessionId,
    childTurnNumber: sp.childTurnNumber,
  }));

  return turnViewModel(t, sessionId, turnSpawns, stepViewModels, dataDir);
}

/**
 * All session ids under parentId (recursive).
 * `visited` = nodes already on the walk path (cycle guard only).
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
    if (next.has(c.id)) continue;
    result.push(c.id);
    result.push(...collectDescendantSessions(c.id, dataDir, next));
  }
  return result;
}
