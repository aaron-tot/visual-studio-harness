import type { SessionAbortPayload } from "../hooks";
import { buildHookContext, getBus } from "../hooks";
import { cancelPermissionsForSession } from "../tools/permission-wait";
import { killBashSession } from "../tools/host/pty-session";

const sessionAborts = new Map<string, AbortController>();

export function getSessionAborts(): Map<string, AbortController> {
  return sessionAborts;
}

// ── per-session "user cancelled" flag ──
// Set when the user presses Stop; checked before auto-continue fires.
// Cleared when a new user-initiated turn begins.

const userCancelledSessions = new Set<string>();

export function markUserCancelled(sessionId: string): void {
  userCancelledSessions.add(sessionId);
}

export function wasUserCancelled(sessionId: string): boolean {
  return userCancelledSessions.has(sessionId);
}

export function clearUserCancelled(sessionId: string): void {
  userCancelledSessions.delete(sessionId);
}

// ── pending continue map (agent_change switch_continue) ──

const pendingContinueMap = new Map<string, { content: string; agentName: string }>();

export function setPendingContinue(sessionId: string, msg: { content: string; agentName: string }): void {
  pendingContinueMap.set(sessionId, msg);
}

export function consumePendingContinue(sessionId: string): { content: string; agentName: string } | undefined {
  const msg = pendingContinueMap.get(sessionId);
  pendingContinueMap.delete(sessionId);
  return msg;
}

export function clearPendingContinue(sessionId: string): void {
  pendingContinueMap.delete(sessionId);
}

// ── session abort ──

function emitSessionAbort(sessionId: string, reason: SessionAbortPayload["reason"], dataDir?: string): void {
  const bus = getBus();
  if (!bus || !sessionId) return;
  const ctx = buildHookContext({ dataDir: dataDir ?? "", source: "ws", sessionId });
  void bus.emit("session.abort", ctx, { sessionId, reason });
}

export function cancelSession(sessionId: string, dataDir?: string): void {
  markUserCancelled(sessionId);
  clearPendingContinue(sessionId);
  const ac = sessionAborts.get(sessionId);
  if (ac) { ac.abort(); sessionAborts.delete(sessionId); }
  killBashSession(sessionId);
  cancelPermissionsForSession(sessionId);
  emitSessionAbort(sessionId, "user_cancel", dataDir);
}
