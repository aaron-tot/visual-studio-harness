import WebSocket from "ws";
import { chatDebug } from "../chat/debug";
import { getSessionMetaPublic } from "./store";
import { projectSessionChat, projectStreamingContent } from "../chat/project-chat";
import { sessionHasTurns, getActiveTraceTurn } from "../chat/db-trace";
import { maxStepPartSeq } from "../chat/project-chat";
import type { Message, MessagePartType } from "../../../_shared/types";

const socketToSession = new Map<WebSocket, string>();
const sessionToSockets = new Map<string, Set<WebSocket>>();

function addSocket(socket: WebSocket, sessionId: string) {
  const prev = socketToSession.get(socket);
  if (prev) {
    const set = sessionToSockets.get(prev);
    if (set) set.delete(socket);
  }
  socketToSession.set(socket, sessionId);
  if (!sessionToSockets.has(sessionId)) sessionToSockets.set(sessionId, new Set());
  sessionToSockets.get(sessionId)!.add(socket);
}

export function setActiveSession(socket: WebSocket, sessionId: string) {
  addSocket(socket, sessionId);
}

export function getActiveSession(socket: WebSocket): string | null {
  return socketToSession.get(socket) ?? null;
}

export function clearActiveSession(socket: WebSocket) {
  const sid = socketToSession.get(socket);
  if (sid) {
    const set = sessionToSockets.get(sid);
    if (set) { set.delete(socket); if (set.size === 0) sessionToSockets.delete(sid); }
  }
  socketToSession.delete(socket);
}

export function sendToSession(sessionId: string, data: unknown) {
  const set = sessionToSockets.get(sessionId);
  const type = (data as { type?: string } | null)?.type;
  if (!set || set.size === 0) {
    chatDebug("sendToSession", "SILENT DROP: no sockets registered for session", { sessionId, type });
    return;
  }
  const msg = JSON.stringify(data);
  let sent = 0;
  let skipped = 0;
  for (const sock of set) {
    if (sock.readyState === WebSocket.OPEN) { sock.send(msg); sent++; }
    else skipped++;
  }
  chatDebug("sendToSession", "delivered", { sessionId, type, sent, skipped });
}

function buildSessionStatePayload(sessionId: string, requestId?: number): Record<string, unknown> {
  const history = projectSessionChat(sessionId);
  const openTurn = getActiveTraceTurn(sessionId);
  const streaming = openTurn ? projectStreamingContent(sessionId) : null;
  return { type: "session_state", sessionId, ...(requestId != null ? { requestId } : {}), history, streaming };
}

export function sendSessionState(socket: WebSocket, sessionId: string, requestId?: number): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(buildSessionStatePayload(sessionId, requestId)));
}

export function sendSessionStateToSession(sessionId: string): void {
  const payload = buildSessionStatePayload(sessionId);
  sendToSession(sessionId, payload);
}
