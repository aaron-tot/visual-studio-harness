import { eq, and, desc } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { subagentSpawns, turns, stepParts, steps } from "../../db/schema";

export interface SubagentSpawnRow {
  id: number;
  parentSessionId: string;
  parentTurnId: number;
  parentTurnNumber: number;
  parentStepId: number;
  parentStepIndex: number;
  toolCallId: string;
  childSessionId: string;
  childTurnId: number | null;
  childTurnNumber: number | null;
  kind: "spawn" | "resume";
  taskLabel: string | null;
  createdAt: string;
}

export type SubagentSpawnInsert = Omit<SubagentSpawnRow, "id" | "createdAt">;

/**
 * Insert a spawn edge. On conflict of tool_call_id (unique), updates child turn
 * fields so retries stay idempotent.
 */
export function insertSubagentSpawn(
  data: SubagentSpawnInsert,
  dataDir?: string,
): number {
  const db = getDbForDataDir(dataDir);
  const createdAt = new Date().toISOString();
  const result = db
    .insert(subagentSpawns)
    .values({ ...data, createdAt })
    .onConflictDoUpdate({
      target: subagentSpawns.toolCallId,
      set: {
        childSessionId: data.childSessionId,
        childTurnId: data.childTurnId,
        childTurnNumber: data.childTurnNumber,
        kind: data.kind,
        taskLabel: data.taskLabel,
        parentTurnId: data.parentTurnId,
        parentTurnNumber: data.parentTurnNumber,
        parentStepId: data.parentStepId,
        parentStepIndex: data.parentStepIndex,
        parentSessionId: data.parentSessionId,
      },
    })
    .returning({ id: subagentSpawns.id })
    .get();
  return result.id;
}

export function listSpawnsForSession(
  parentSessionId: string,
  dataDir?: string,
): SubagentSpawnRow[] {
  const db = getDbForDataDir(dataDir);
  return db
    .select()
    .from(subagentSpawns)
    .where(eq(subagentSpawns.parentSessionId, parentSessionId))
    .orderBy(subagentSpawns.id)
    .all() as unknown as SubagentSpawnRow[];
}

export function listSpawnsForTurn(
  parentTurnId: number,
  dataDir?: string,
): SubagentSpawnRow[] {
  const db = getDbForDataDir(dataDir);
  return db
    .select()
    .from(subagentSpawns)
    .where(eq(subagentSpawns.parentTurnId, parentTurnId))
    .orderBy(subagentSpawns.id)
    .all() as unknown as SubagentSpawnRow[];
}

export function getSpawnByToolCallId(
  toolCallId: string,
  dataDir?: string,
): SubagentSpawnRow | null {
  const db = getDbForDataDir(dataDir);
  const row = db
    .select()
    .from(subagentSpawns)
    .where(eq(subagentSpawns.toolCallId, toolCallId))
    .get();
  return (row as unknown as SubagentSpawnRow) ?? null;
}

export function getLatestChildTurn(
  childSessionId: string,
  dataDir?: string,
): { turnId: number; turnNumber: number } | null {
  const db = getDbForDataDir(dataDir);
  const row = db
    .select({ turnId: turns.id, turnNumber: turns.turnNumber })
    .from(turns)
    .where(eq(turns.sessionId, childSessionId))
    .orderBy(desc(turns.turnNumber))
    .get();
  if (!row) return null;
  return { turnId: row.turnId, turnNumber: row.turnNumber };
}

export function resolveParentStepForToolCall(
  sessionId: string,
  toolCallId: string,
  dataDir?: string,
): { turnId: number; turnNumber: number; stepId: number; stepIndex: number } | null {
  const db = getDbForDataDir(dataDir);
  const part = db
    .select({ turnId: stepParts.turnId, stepId: stepParts.stepId })
    .from(stepParts)
    .where(and(eq(stepParts.sessionId, sessionId), eq(stepParts.toolCallId, toolCallId)))
    .get();
  if (!part) return null;
  const turnRow = db
    .select({ turnNumber: turns.turnNumber })
    .from(turns)
    .where(eq(turns.id, part.turnId))
    .get();
  const stepRow = db
    .select({ stepIndex: steps.stepIndex })
    .from(steps)
    .where(eq(steps.id, part.stepId))
    .get();
  if (!turnRow || !stepRow) return null;
  return {
    turnId: part.turnId,
    turnNumber: turnRow.turnNumber,
    stepId: part.stepId,
    stepIndex: stepRow.stepIndex,
  };
}

/**
 * Full write path for a task tool completion (success, error, or cancel)
 * when a child session id is known.
 *
 * - Resolves parent turn/step from the parent tool part (`toolCallId`)
 * - Always loads latest child turn for both id + number
 * - Upserts by toolCallId (idempotent)
 *
 * @returns spawn row id, or null if parent step could not be resolved
 */
export function recordSubagentSpawnEdge(opts: {
  parentSessionId: string;
  toolCallId: string;
  childSessionId: string;
  kind: "spawn" | "resume";
  taskLabel?: string | null;
  dataDir?: string;
}): number | null {
  const childSessionId = opts.childSessionId?.trim();
  if (!childSessionId) return null;
  if (!opts.toolCallId?.trim()) {
    console.warn(
      `[subagent_spawns] missing toolCallId for child session ${childSessionId}`
    );
    return null;
  }

  const stepInfo = resolveParentStepForToolCall(
    opts.parentSessionId,
    opts.toolCallId,
    opts.dataDir
  );
  if (!stepInfo) {
    console.warn(
      `[subagent_spawns] could not resolve parent step for toolCallId=${opts.toolCallId} ` +
        `parentSession=${opts.parentSessionId} childSession=${childSessionId} — edge not recorded`
    );
    return null;
  }

  // Always resolve both id + number from DB (do not trust partial metadata)
  const childTurn = getLatestChildTurn(childSessionId, opts.dataDir);

  try {
    return insertSubagentSpawn(
      {
        parentSessionId: opts.parentSessionId,
        parentTurnId: stepInfo.turnId,
        parentTurnNumber: stepInfo.turnNumber,
        parentStepId: stepInfo.stepId,
        parentStepIndex: stepInfo.stepIndex,
        toolCallId: opts.toolCallId,
        childSessionId,
        childTurnId: childTurn?.turnId ?? null,
        childTurnNumber: childTurn?.turnNumber ?? null,
        kind: opts.kind,
        taskLabel: opts.taskLabel ?? null,
      },
      opts.dataDir
    );
  } catch (err) {
    console.warn(
      `[subagent_spawns] insert failed toolCallId=${opts.toolCallId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function computeInclusiveTotalTokens(
  own: number,
  childOwns: number[],
): number {
  return own + childOwns.reduce((sum, c) => sum + c, 0);
}
