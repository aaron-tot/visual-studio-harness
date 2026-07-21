import { getHooksSystem } from "./system";
import type { HookBus } from "./bus";

/** Safe bus access: null if boot has not called setHooksSystem yet. */
export function getBus(): HookBus | null {
  return getHooksSystem()?.bus ?? null;
}
