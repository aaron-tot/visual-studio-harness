import { createHookBus, type HookBus } from "./bus";
import { registerBuiltInHandlers } from "./handlers";

export interface HooksSystem {
  bus: HookBus;
}

/** Create bus + built-in handlers. Call once at app boot. */
export function createHooksSystem(): HooksSystem {
  const bus = createHookBus();
  registerBuiltInHandlers(bus);
  return { bus };
}

let appHooks: HooksSystem | null = null;

/** Install the process-wide hooks system (Phase B call sites use getHooks). Pass null to clear (tests). */
export function setHooksSystem(system: HooksSystem | null): void {
  appHooks = system;
}

export function getHooksSystem(): HooksSystem | null {
  return appHooks;
}

/** Prefer this when Phase B wires emits; throws if boot forgot setHooksSystem. */
export function requireHooks(): HooksSystem {
  if (!appHooks) {
    throw new Error("hooks system not initialized; call setHooksSystem(createHooksSystem()) at boot");
  }
  return appHooks;
}
