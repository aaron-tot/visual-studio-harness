interface SessionRuntime {
  abortController: AbortController;
  turnId: number;
  startedAt: number;
  status: "streaming" | "awaiting_permission" | "awaiting_config";
}

const activeSessions = new Map<string, SessionRuntime>();

export function registerSession(
  sessionId: string,
  abortController: AbortController,
  turnId: number
): void {
  activeSessions.set(sessionId, {
    abortController,
    turnId,
    startedAt: Date.now(),
    status: "streaming",
  });
}

export function unregisterSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

export function getSessionRuntime(sessionId: string): SessionRuntime | undefined {
  return activeSessions.get(sessionId);
}

export function updateSessionStatus(
  sessionId: string,
  status: SessionRuntime["status"]
): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.status = status;
  }
}

export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys());
}
