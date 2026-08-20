/** Wait for user decision when LLM slots are busy (ask policy). */

export type SlotBusyAction = "wait" | "fail" | "cancel";

export interface SlotBusyResponse {
  action: SlotBusyAction;
  /** Optional one-shot poll interval override (seconds) */
  pollIntervalSec?: number;
  /** Optional one-shot wait timeout override (seconds); 0 = no timeout */
  waitTimeoutSec?: number;
}

type Pending = {
  resolve: (value: SlotBusyResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  /** SessionId owning this wait, for scoped cancellation. */
  owningSessionId: string;
};

const pending = new Map<string, Pending>();
const DEFAULT_TIMEOUT_MS = 180_000;

export function waitForSlotBusyDecision(
  requestId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  owningSessionId?: string
): Promise<SlotBusyResponse> {
  return new Promise((resolve) => {
    const existing = pending.get(requestId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ action: "cancel" });
    }
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ action: "cancel" });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer, owningSessionId: owningSessionId ?? "" });
  });
}

export function resolveSlotBusyDecision(
  requestId: string,
  value: SlotBusyResponse
): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(value);
  return true;
}

/** Resolve + drop every pending wait owned by the given session. */
export function cancelSlotBusyDecisionsForSession(sessionId: string): void {
  const keys = Array.from(pending.keys());
  for (const id of keys) {
    const p = pending.get(id);
    if (!p || (p.owningSessionId && p.owningSessionId !== sessionId)) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve({ action: "cancel" });
  }
}
