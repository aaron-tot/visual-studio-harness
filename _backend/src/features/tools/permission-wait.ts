type Pending = {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** toolCallId -> waiter */
const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 120_000;

export function waitForPermission(
  toolCallId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<boolean> {
  // If already resolved somehow, deny
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
    pending.set(toolCallId, { resolve, timer });
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

export function cancelPermissionsForSession(_sessionId: string): void {
  // V1: deny all pending (toolCallIds are unique; session filter optional later)
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve(false);
    pending.delete(id);
  }
}
