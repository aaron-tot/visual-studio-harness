import type { HookBus } from "../bus";
import { registerLoggingHandler } from "./logging";

/** Register all built-in handlers. Safe to call once at boot. */
export function registerBuiltInHandlers(bus: HookBus): void {
  registerLoggingHandler(bus);
}
