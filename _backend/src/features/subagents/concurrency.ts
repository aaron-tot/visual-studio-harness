/**
 * Serial (and later parallel) gate for subagent runs.
 * v1: maxConcurrent is always treated as at least 1; callers pass config value.
 */

type Waiter = () => void;

const state = {
  active: 0,
  queue: [] as Waiter[],
};

export async function withSubagentSlot<T>(
  maxConcurrent: number,
  fn: () => Promise<T>
): Promise<T> {
  const limit = Math.max(1, maxConcurrent | 0);
  if (state.active >= limit) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;
  try {
    return await fn();
  } finally {
    state.active--;
    const next = state.queue.shift();
    if (next) next();
  }
}

/** Test helper */
export function _resetConcurrencyForTests(): void {
  state.active = 0;
  state.queue = [];
}
