/**
 * Active slot-wait sessions: user can force-timeout from the UI.
 * Keyed by requestId (same id used for slot_busy ask / slot wait).
 */

type ForceFn = () => void;

const forceHandlers = new Map<string, ForceFn>();

export function registerSlotWaitForce(
  requestId: string,
  onForce: ForceFn
): void {
  const prev = forceHandlers.get(requestId);
  if (prev) prev(); // cancel previous
  forceHandlers.set(requestId, onForce);
}

export function unregisterSlotWaitForce(requestId: string): void {
  forceHandlers.delete(requestId);
}

/** User clicked Force timeout. Returns false if nothing waiting. */
export function forceSlotWaitTimeout(requestId: string): boolean {
  const fn = forceHandlers.get(requestId);
  if (!fn) return false;
  forceHandlers.delete(requestId);
  fn();
  return true;
}

export function forceAllSlotWaits(): void {
  for (const [id, fn] of forceHandlers) {
    forceHandlers.delete(id);
    fn();
  }
}
