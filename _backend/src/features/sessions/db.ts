import { eq, ne, or, isNull, desc, and, lte, lt } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { sessions, sessionLayouts, summaryRanges, turns } from "../../db/schema";
import type { SessionMeta, LayoutNode } from "../../../../_shared/types";

export function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

function rowToSessionMeta(
  row: Pick<
    typeof sessions.$inferSelect,
    | "id" | "title" | "providerName" | "modelName" | "workspaceRoot" | "kind"
    | "parentId" | "taskLabel" | "agentName" | "thinkingEffort"
    | "created" | "updated" | "archived" | "starred"
  >,
): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    providerName: row.providerName ?? "",
    modelName: row.modelName ?? "",
    workspaceRoot: row.workspaceRoot ?? undefined,
    kind: row.kind as SessionMeta["kind"],
    parentId: row.parentId ?? undefined,
    taskLabel: row.taskLabel ?? undefined,
    agentName: row.agentName ?? undefined,
    thinkingEffort: row.thinkingEffort as SessionMeta["thinkingEffort"],
    created: row.created,
    updated: row.updated,
    archived: row.archived,
    starred: row.starred || undefined,
  };
}

export function createSession(meta: SessionMeta, dataDir?: string): void {
  const db = dbFor(dataDir);
  db.insert(sessions)
    .values({
      id: meta.id,
      title: meta.title,
      providerName: meta.providerName ?? null,
      modelName: meta.modelName ?? null,
      workspaceRoot: meta.workspaceRoot ?? null,
      kind: meta.kind ?? "primary",
      parentId: meta.parentId ?? null,
      taskLabel: meta.taskLabel ?? null,
      agentName: meta.agentName ?? null,
      thinkingEffort: meta.thinkingEffort ?? null,
      created: meta.created,
      updated: meta.updated,
      archived: meta.archived ?? false,
      starred: meta.starred ?? false,
    })
    .onConflictDoNothing()
    .run();
}

export function getSession(id: string, dataDir?: string): SessionMeta | null {
  const db = dbFor(dataDir);
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return null;
  return rowToSessionMeta(row);
}

export function listSessions(opts?: {
  includeSubagents?: boolean;
  includeArchived?: boolean;
  dataDir?: string;
}): SessionMeta[] {
  const db = dbFor(opts?.dataDir);
  // Trim to list-only columns (never read system_prompt / todos / model config
  // blobs) and enforce `archived = 0` in SQL, not JS. After the archive
  // migration most of these rows are gone from live entirely; this keeps the
  // query plan from touching blob columns.
  const cols = {
    id: sessions.id,
    title: sessions.title,
    providerName: sessions.providerName,
    modelName: sessions.modelName,
    workspaceRoot: sessions.workspaceRoot,
    kind: sessions.kind,
    parentId: sessions.parentId,
    taskLabel: sessions.taskLabel,
    agentName: sessions.agentName,
    thinkingEffort: sessions.thinkingEffort,
    created: sessions.created,
    updated: sessions.updated,
    archived: sessions.archived,
    starred: sessions.starred,
  };
  const conditions = [eq(sessions.archived, false)];
  if (!opts?.includeSubagents) {
    conditions.push(or(isNull(sessions.kind), ne(sessions.kind, "subagent"))!);
  }
  const rows = db
    .select(cols)
    .from(sessions)
    .where(and(...conditions)!)
    .orderBy(desc(sessions.updated))
    .all();
  return rows.map(rowToSessionMeta);
}

/** Direct children of a parent (kind=subagent, not archived) without scanning every session. */
export function listChildSessions(
  parentId: string,
  dataDir?: string
): SessionMeta[] {
  const db = dbFor(dataDir);
  const rows = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.parentId, parentId), eq(sessions.archived, false)))
    .orderBy(desc(sessions.updated))
    .all();
  return rows.map(rowToSessionMeta);
}

export function updateSessionFields(
  id: string,
  fields: Partial<SessionMeta> & {
    systemPrompt?: string | null;
    todosJson?: string | null;
    modelConfigJson?: string | null;
    sessionPermsJson?: string | null;
    draftInput?: string | null;
  },
  dataDir?: string
): SessionMeta | null {
  const db = dbFor(dataDir);
  let existing = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!existing) {
    const now = new Date().toISOString();
    db.insert(sessions)
      .values({
        id,
        title: fields.title ?? id,
        providerName: fields.providerName ?? null,
        modelName: fields.modelName ?? null,
        workspaceRoot: fields.workspaceRoot ?? null,
        kind: fields.kind ?? "primary",
        parentId: fields.parentId ?? null,
        taskLabel: fields.taskLabel ?? null,
        agentName: fields.agentName ?? null,
        thinkingEffort: fields.thinkingEffort ?? null,
        created: fields.created ?? now,
        updated: fields.updated ?? now,
        archived: fields.archived ?? false,
        starred: fields.starred ?? false,
      })
      .onConflictDoNothing()
      .run();
    existing = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!existing) return null;
  }

  const patch: Record<string, unknown> = {
    updated: fields.updated ?? new Date().toISOString(),
  };
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.providerName !== undefined) patch.providerName = fields.providerName;
  if (fields.modelName !== undefined) patch.modelName = fields.modelName;
  if (fields.workspaceRoot !== undefined) patch.workspaceRoot = fields.workspaceRoot;
  if (fields.kind !== undefined) patch.kind = fields.kind;
  if (fields.parentId !== undefined) patch.parentId = fields.parentId ?? null;
  if (fields.taskLabel !== undefined) patch.taskLabel = fields.taskLabel ?? null;
  if (fields.agentName !== undefined) patch.agentName = fields.agentName ?? null;
  if (fields.thinkingEffort !== undefined) patch.thinkingEffort = fields.thinkingEffort ?? null;
  if (fields.archived !== undefined) patch.archived = fields.archived;
  if (fields.starred !== undefined) patch.starred = fields.starred;
  if (fields.systemPrompt !== undefined) patch.systemPrompt = fields.systemPrompt;
  if (fields.todosJson !== undefined) patch.todosJson = fields.todosJson;
  if (fields.modelConfigJson !== undefined) patch.modelConfigJson = fields.modelConfigJson;
  if (fields.sessionPermsJson !== undefined) patch.sessionPermsJson = fields.sessionPermsJson;
  if (fields.draftInput !== undefined) patch.draftInput = fields.draftInput;

  db.update(sessions).set(patch).where(eq(sessions.id, id)).run();
  return getSession(id, dataDir);
}

export function setSessionSystemPrompt(
  id: string,
  content: string,
  dataDir?: string
): void {
  updateSessionFields(id, { systemPrompt: content }, dataDir);
}

export function getSessionSystemPrompt(id: string, dataDir?: string): string {
  const db = dbFor(dataDir);
  const row = db
    .select({ systemPrompt: sessions.systemPrompt })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row?.systemPrompt ?? "";
}

export function getSessionTodosJson(id: string, dataDir?: string): string | null {
  const db = dbFor(dataDir);
  const row = db
    .select({ todosJson: sessions.todosJson })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row?.todosJson ?? null;
}

export function setSessionTodosJson(
  id: string,
  todosJson: string,
  dataDir?: string
): void {
  updateSessionFields(id, { todosJson }, dataDir);
}

export function getSessionModelConfigJson(
  id: string,
  dataDir?: string
): string | null {
  const db = dbFor(dataDir);
  const row = db
    .select({ modelConfigJson: sessions.modelConfigJson })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row?.modelConfigJson ?? null;
}

export function setSessionModelConfigJson(
  id: string,
  modelConfigJson: string,
  dataDir?: string
): void {
  updateSessionFields(id, { modelConfigJson }, dataDir);
}

export function getSessionPermsJson(id: string, dataDir?: string): string | null {
  const db = dbFor(dataDir);
  const row = db
    .select({ sessionPermsJson: sessions.sessionPermsJson })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row?.sessionPermsJson ?? null;
}

export function setSessionPermsJson(
  id: string,
  sessionPermsJson: string,
  dataDir?: string
): void {
  updateSessionFields(id, { sessionPermsJson }, dataDir);
}

export function getSessionDraftInput(id: string, dataDir?: string): string | null {
  const db = dbFor(dataDir);
  const row = db
    .select({ draftInput: sessions.draftInput })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row?.draftInput ?? null;
}

export function setSessionDraftInput(
  id: string,
  draftInput: string,
  dataDir?: string
): void {
  updateSessionFields(id, { draftInput }, dataDir);
}

export function getSessionLayout(
  workspaceRoot: string,
  dataDir?: string
): LayoutNode[] | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(sessionLayouts)
    .where(eq(sessionLayouts.workspaceRoot, workspaceRoot))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.itemsJson);
    return Array.isArray(parsed) ? (parsed as LayoutNode[]) : null;
  } catch {
    return null;
  }
}

export function setSessionLayout(
  workspaceRoot: string,
  tree: LayoutNode[],
  dataDir?: string
): void {
  const db = dbFor(dataDir);
  const json = JSON.stringify(tree);
  const now = new Date().toISOString();
  db.insert(sessionLayouts)
    .values({ workspaceRoot, itemsJson: json, updated: now })
    .onConflictDoUpdate({
      target: sessionLayouts.workspaceRoot,
      set: { itemsJson: json, updated: now },
    })
    .run();
}

// ── Summary ranges (in-context summarization sliding chain) ──────────────
// A "range" = one summarization run. It links a summary turn (kind='summary')
// to the turn span it compresses: [startTurn .. endTurn]. Chained via prevRangeId.

export interface SummaryRange {
  id: number;
  sessionId: string;
  summaryTurnId: number;
  startTurn: number;
  endTurn: number;
  prevRangeId: number | null;
  originalTokens: number | null;
  summaryTokens: number | null;
  createdAt: string;
}

export function insertSummaryRange(
  dataDir: string,
  range: Omit<SummaryRange, "id">
): number {
  const db = dbFor(dataDir);
  const result = db
    .insert(summaryRanges)
    .values({
      sessionId: range.sessionId,
      summaryTurnId: range.summaryTurnId,
      startTurn: range.startTurn,
      endTurn: range.endTurn,
      prevRangeId: range.prevRangeId,
      originalTokens: range.originalTokens,
      summaryTokens: range.summaryTokens,
      createdAt: range.createdAt,
    })
    .returning({ id: summaryRanges.id })
    .get();
  return result?.id ?? 0;
}

export function getLatestSummaryRange(
  dataDir: string,
  sessionId: string
): SummaryRange | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(summaryRanges)
    .where(eq(summaryRanges.sessionId, sessionId))
    .orderBy(desc(summaryRanges.endTurn))
    .limit(1)
    .get();
  return row ?? null;
}

/** Latest range whose endTurn is strictly before `beforeEndTurn` (for chain start). */
export function getLatestSummaryRangeBefore(
  dataDir: string,
  sessionId: string,
  beforeEndTurn: number,
): SummaryRange | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(summaryRanges)
    .where(and(eq(summaryRanges.sessionId, sessionId), lt(summaryRanges.endTurn, beforeEndTurn)))
    .orderBy(desc(summaryRanges.endTurn))
    .limit(1)
    .get();
  return row ?? null;
}

/** Range that ends exactly at endTurn (slider position already summarized). */
export function getSummaryRangeByEndTurn(
  dataDir: string,
  sessionId: string,
  endTurn: number,
): SummaryRange | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(summaryRanges)
    .where(and(eq(summaryRanges.sessionId, sessionId), eq(summaryRanges.endTurn, endTurn)))
    .get();
  return row ?? null;
}

export function getEarliestLiveSummaryRange(
  dataDir: string,
  sessionId: string,
  sliderTurn: number
): SummaryRange | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(summaryRanges)
    .where(and(eq(summaryRanges.sessionId, sessionId), lte(summaryRanges.endTurn, sliderTurn)))
    .orderBy(summaryRanges.endTurn)
    .limit(1)
    .get();
  return row ?? null;
}

export function getSummaryRangeByRange(
  dataDir: string,
  sessionId: string,
  startTurn: number,
  endTurn: number
): SummaryRange | null {
  const db = dbFor(dataDir);
  const row = db
    .select()
    .from(summaryRanges)
    .where(and(eq(summaryRanges.sessionId, sessionId), eq(summaryRanges.startTurn, startTurn), eq(summaryRanges.endTurn, endTurn)))
    .get();
  return row ?? null;
}

export function getSummaryRangesForSession(
  dataDir: string,
  sessionId: string
): SummaryRange[] {
  const db = dbFor(dataDir);
  return db
    .select()
    .from(summaryRanges)
    .where(eq(summaryRanges.sessionId, sessionId))
    .orderBy(summaryRanges.endTurn)
    .all();
}

/**
 * Summary turns currently being generated (kind='summary', status='pending').
 * The placeholder is deliberately NOT 'streaming' — it is a display marker,
 * not a live turn, so session_state streaming detection ignores it.
 * Used to guard against concurrent generation for the same range and to
 * recover from crashes that left a stale pending row behind.
 */
export interface PendingSummaryTurn {
  id: number;
  turnNumber: number;
  configSnapshotJson: string | null;
  startedAt: string | null;
}

export function getPendingSummaryTurns(
  dataDir: string,
  sessionId: string
): PendingSummaryTurn[] {
  const db = dbFor(dataDir);
  return db
    .select({
      id: turns.id,
      turnNumber: turns.turnNumber,
      configSnapshotJson: turns.configSnapshotJson,
      startedAt: turns.startedAt,
    })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "summary"), eq(turns.status, "pending")))
    .all();
}

/** Mark a summary turn as failed (status='error', success=0). */
export function markSummaryTurnError(dataDir: string, turnId: number): void {
  const db = dbFor(dataDir);
  db.update(turns)
    .set({ status: "error", success: false })
    .where(eq(turns.id, turnId))
    .run();
}

/**
 * Convert stale in-progress summary turns (startedAt older than `olderThanMs`)
 * into errors so a fresh generation is not blocked forever by a crashed run.
 * Returns the ids that were marked.
 */
export function expireStaleSummaryPlaceholders(
  dataDir: string,
  sessionId: string,
  olderThanMs: number
): number[] {
  const now = Date.now();
  const expired: number[] = [];
  for (const row of getPendingSummaryTurns(dataDir, sessionId)) {
    if (!row.startedAt) {
      expired.push(row.id);
      continue;
    }
    const started = new Date(row.startedAt).getTime();
    if (Number.isNaN(started) || now - started > olderThanMs) {
      expired.push(row.id);
    }
  }
  for (const id of expired) markSummaryTurnError(dataDir, id);
  return expired;
}
