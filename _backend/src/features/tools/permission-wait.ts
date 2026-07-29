type Pending = {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  /** SessionId that owns this permission request, for scoped cancellation. */
  owningSessionId: string;
};

/** toolCallId -> waiter */
const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 120_000;

export function waitForPermission(
  toolCallId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  /** Optional sessionId for scoped cancellation. Defaults to "" (global scope). */
  owningSessionId?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = pending.get(toolCallId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(false);
    }
    const timer = setTimeout(() => {
      pending.delete(toolCallId);
      resolve(false);
    }, timeoutMs);
    pending.set(toolCallId, { resolve, timer, owningSessionId: owningSessionId ?? "" });
  });
}

export function resolvePermission(toolCallId: string, approved: boolean): boolean {
  const p = pending.get(toolCallId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(toolCallId);
  p.resolve(approved);
  return true;
}

export function cancelPermissionsForSession(sessionId: string): void {
  // Collect keys first to avoid Map mutation during iteration
  const keys = Array.from(pending.keys());
  for (const id of keys) {
    const p = pending.get(id);
    if (!p) continue;
    // Only cancel permissions owned by this session
    if (p.owningSessionId && p.owningSessionId !== sessionId) continue;
    clearTimeout(p.timer);
    p.resolve(false);
    pending.delete(id);
  }
}
