/**
 * Session API — SQLite only (visual-studio-harness.db sessions + trace turns).
 *
 * data/{mode}/sessions/ is created as an empty placeholder directory and is
 * not read or written for session data. No file fallbacks.
 */
import type { Session, SessionMeta, TurnData, TurnsFile, LayoutNode } from "../../../_shared/types";
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSessionFields,
  archiveSession as dbArchiveSession,
  setSessionSystemPrompt,
  getSessionSystemPrompt,
  getSessionLayout as dbGetSessionLayout,
  setSessionLayout as dbSetSessionLayout,
} from "./db";
import {
  projectSessionChat,
  listTurnSummaries,
  getTurnDetail,
} from "../chat/project-chat";
import { sessionHasTurns } from "../chat/db-trace";

export interface ListSessionsOptions {
  /** When true, include subagent child sessions. Default false. */
  includeSubagents?: boolean;
}

export async function listSessions(
  dataDir: string,
  opts?: ListSessionsOptions
): Promise<SessionMeta[]> {
  return dbListSessions({
    includeSubagents: opts?.includeSubagents,
    dataDir,
  });
}

export async function listChildSessions(
  dataDir: string,
  parentId: string
): Promise<SessionMeta[]> {
  const all = await listSessions(dataDir, { includeSubagents: true });
  return all.filter((s) => s.kind === "subagent" && s.parentId === parentId);
}

export async function getSession(
  dataDir: string,
  id: string
): Promise<Session | null> {
  const meta = dbGetSession(id, dataDir);
  if (!meta) return null;
  const messages = sessionHasTurns(id, dataDir)
    ? projectSessionChat(id, dataDir)
    : [];
  return { meta, messages };
}

/** Insert session row in SQLite only. Does not create sessions/<id>/. */
export async function createSession(
  dataDir: string,
  meta: SessionMeta
): Promise<void> {
  dbCreateSession(meta, dataDir);
}

export async function deleteSession(dataDir: string, id: string): Promise<void> {
  dbArchiveSession(id, dataDir);
}

export async function renameSession(
  dataDir: string,
  id: string,
  title: string
): Promise<void> {
  updateSessionFields(id, { title }, dataDir);
}

/** Last system prompt on the session row. */
export async function writeSessionSystemPrompt(
  dataDir: string,
  id: string,
  content: string
): Promise<void> {
  setSessionSystemPrompt(id, content, dataDir);
}

export async function readSessionSystemPrompt(
  dataDir: string,
  id: string
): Promise<string> {
  return getSessionSystemPrompt(id, dataDir);
}

export async function updateSessionTimestamp(
  dataDir: string,
  id: string
): Promise<void> {
  updateSessionFields(id, { updated: new Date().toISOString() }, dataDir);
}

export async function updateSessionWorkspace(
  dataDir: string,
  id: string,
  workspaceRoot: string
): Promise<SessionMeta> {
  const meta = updateSessionFields(id, { workspaceRoot }, dataDir);
  if (!meta) throw new Error("Session not found");
  return meta;
}

export async function updateSessionAgentName(
  dataDir: string,
  id: string,
  agentName: string | undefined
): Promise<SessionMeta> {
  const meta = updateSessionFields(id, { agentName }, dataDir);
  if (!meta) throw new Error("Session not found");
  return meta;
}

export async function updateSessionMeta(
  dataDir: string,
  id: string,
  fields: Partial<SessionMeta>
): Promise<SessionMeta> {
  const meta = updateSessionFields(id, fields, dataDir);
  if (!meta) throw new Error("Session not found");
  return meta;
}

export async function listWorkspaces(dataDir: string): Promise<string[]> {
  const sessions = await listSessions(dataDir);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) {
    const w = s.workspaceRoot?.trim();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export async function getSessionLayout(
  dataDir: string,
  workspaceRoot: string
): Promise<LayoutNode[] | null> {
  return dbGetSessionLayout(workspaceRoot, dataDir);
}

export async function setSessionLayout(
  dataDir: string,
  workspaceRoot: string,
  tree: LayoutNode[]
): Promise<void> {
  dbSetSessionLayout(workspaceRoot, tree, dataDir);
}

export async function getSessionMetaPublic(
  dataDir: string,
  id: string
): Promise<SessionMeta | null> {
  return dbGetSession(id, dataDir);
}

export async function getTurns(
  dataDir: string,
  id: string
): Promise<TurnsFile> {
  if (!sessionHasTurns(id, dataDir)) return {};
  const summaries = listTurnSummaries(id, dataDir);
  const turns: TurnsFile = {};
  for (const s of summaries) {
    turns[String(s.turnNumber)] = {
      systemMessage: "",
      messages: [],
      success: s.success,
    };
  }
  return turns;
}

export async function getTurn(
  dataDir: string,
  id: string,
  turnId: number
): Promise<TurnData | null> {
  return getTurnDetail(id, turnId, dataDir) as TurnData | null;
}
