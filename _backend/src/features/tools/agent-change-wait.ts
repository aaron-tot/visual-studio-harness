import type { AgentChangeReply } from "./types";

type Pending = {
  resolve: (value: AgentChangeReply) => void;
  timer: ReturnType<typeof setTimeout>;
  /** SessionId owning this wait, for scoped cancellation. */
  owningSessionId: string;
};

const pending = new Map<string, Pending>();
const DEFAULT_TIMEOUT_MS = 180_000;

export function waitForAgentChange(
  requestId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  owningSessionId?: string
): Promise<AgentChangeReply> {
  return new Promise((resolve) => {
    const existing = pending.get(requestId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ action: "stop" });
    }
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ action: "stop" });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer, owningSessionId: owningSessionId ?? "" });
  });
}

export function resolveAgentChange(
  requestId: string,
  value: AgentChangeReply
): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(value);
  return true;
}

export function cancelAgentChangeRequests(): void {
  // Collect keys first to avoid Map mutation during iteration
  const keys = Array.from(pending.keys());
  for (const id of keys) {
    const p = pending.get(id);
    if (!p) continue;
    clearTimeout(p.timer);
    p.resolve({ action: "stop" });
    pending.delete(id);
  }
}

/** Resolve + drop every pending wait owned by the given session. */
export function cancelAgentChangeRequestsForSession(sessionId: string): void {
  const keys = Array.from(pending.keys());
  for (const id of keys) {
    const p = pending.get(id);
    if (!p || (p.owningSessionId && p.owningSessionId !== sessionId)) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve({ action: "stop" });
  }
}
