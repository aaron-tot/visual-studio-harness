import type { AgentChangeReply } from "./types";

type Pending = {
  resolve: (value: AgentChangeReply) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
const DEFAULT_TIMEOUT_MS = 180_000;

export function waitForAgentChange(
  requestId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
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
    pending.set(requestId, { resolve, timer });
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
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ action: "stop" });
    pending.delete(id);
  }
}
