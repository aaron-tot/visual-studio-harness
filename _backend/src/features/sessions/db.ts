import { eq, desc } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { sessions, sessionLayouts } from "../../db/schema";
import type { SessionMeta, LayoutNode } from "../../../../_shared/types";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

function rowToSessionMeta(row: typeof sessions.$inferSelect): SessionMeta {
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
  let rows = db.select().from(sessions).orderBy(desc(sessions.updated)).all();
  if (!opts?.includeArchived) {
    rows = rows.filter((r) => !r.archived);
  }
  if (!opts?.includeSubagents) {
    rows = rows.filter((r) => (r.kind || "primary") !== "subagent");
  }
  return rows.map(rowToSessionMeta);
}

export function updateSessionFields(
  id: string,
  fields: Partial<SessionMeta> & {
    systemPrompt?: string | null;
    todosJson?: string | null;
    modelConfigJson?: string | null;
    sessionPermsJson?: string | null;
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
  if (fields.systemPrompt !== undefined) patch.systemPrompt = fields.systemPrompt;
  if (fields.todosJson !== undefined) patch.todosJson = fields.todosJson;
  if (fields.modelConfigJson !== undefined) patch.modelConfigJson = fields.modelConfigJson;
  if (fields.sessionPermsJson !== undefined) patch.sessionPermsJson = fields.sessionPermsJson;

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

export function archiveSession(id: string, dataDir?: string): SessionMeta | null {
  return updateSessionFields(
    id,
    { archived: true, updated: new Date().toISOString() },
    dataDir
  );
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


