import type { HookName, HookPayloadMap } from "./events";
import {
  getCatalogEntry,
  isActiveHook,
  isInterceptHook,
} from "./catalog";
import type {
  EmitInterceptOutcome,
  HookContext,
  HookHandlerResult,
  HookRegisterOptions,
} from "./types";
import { DEFAULT_HOOK_PRIORITY } from "./types";

export type HookHandler<N extends HookName = HookName> = (
  ctx: HookContext,
  payload: HookPayloadMap[N]
) => void | Promise<void | HookHandlerResult>;

interface RegisteredHandler {
  id: string;
  priority: number;
  handler: HookHandler;
}

const reservedWarned = new Set<string>();

export class HookBus {
  private handlers = new Map<HookName, RegisteredHandler[]>();

  /**
   * Register a handler. Same id on same event replaces the previous handler.
   */
  on<N extends HookName>(
    name: N,
    handler: HookHandler<N>,
    options: HookRegisterOptions
  ): void {
    if (!options.id?.trim()) {
      throw new Error("hooks.on: options.id is required");
    }
    const list = this.handlers.get(name) ?? [];
    const filtered = list.filter((h) => h.id !== options.id);
    filtered.push({
      id: options.id,
      priority: options.priority ?? DEFAULT_HOOK_PRIORITY,
      handler: handler as HookHandler,
    });
    filtered.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    this.handlers.set(name, filtered);
  }

  /** Remove by id. If id omitted, remove all handlers for the event. */
  off(name: HookName, id?: string): void {
    if (id === undefined) {
      this.handlers.delete(name);
      return;
    }
    const list = this.handlers.get(name);
    if (!list) return;
    const next = list.filter((h) => h.id !== id);
    if (next.length === 0) this.handlers.delete(name);
    else this.handlers.set(name, next);
  }

  /** Number of handlers for an event (tests / diagnostics). */
  listenerCount(name: HookName): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  /**
   * Observe emit: run all handlers in priority order.
   * Handler throws are logged and skipped. Return values ignored except logging.
   * Reserved hooks: no-op (dev warn once).
   */
  async emit<N extends HookName>(
    name: N,
    ctx: HookContext,
    payload: HookPayloadMap[N]
  ): Promise<void> {
    if (!this.shouldRun(name)) return;

    const list = this.handlers.get(name);
    if (!list || list.length === 0) return;

    for (const entry of list) {
      try {
        await entry.handler(ctx, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[hooks] handler "${entry.id}" on "${name}" failed: ${msg}`);
      }
    }
  }

  /**
   * Intercept emit: run handlers in priority order; merge patches; stop on cancel.
   * Handler throws are logged and do not cancel (fail-open).
   * Non-intercept catalog hooks fall back to observe-only emit.
   */
  async emitIntercept<N extends HookName>(
    name: N,
    ctx: HookContext,
    payload: HookPayloadMap[N]
  ): Promise<EmitInterceptOutcome> {
    const outcome: EmitInterceptOutcome = {
      cancelled: false,
      patch: {},
    };

    if (!this.shouldRun(name)) return outcome;

    if (!isInterceptHook(name)) {
      await this.emit(name, ctx, payload);
      return outcome;
    }

    const list = this.handlers.get(name);
    if (!list || list.length === 0) return outcome;

    let currentPayload = payload;

    for (const entry of list) {
      try {
        const result = await entry.handler(ctx, currentPayload);
        if (!result || typeof result !== "object") continue;

        if (result.patch && typeof result.patch === "object") {
          outcome.patch = { ...outcome.patch, ...result.patch };
          // Allow subsequent handlers to see merged patch on payload.args if present
          if (
            currentPayload &&
            typeof currentPayload === "object" &&
            "args" in currentPayload &&
            result.patch.args !== undefined
          ) {
            currentPayload = {
              ...currentPayload,
              args: result.patch.args,
            };
          }
        }

        if (result.cancel) {
          outcome.cancelled = true;
          outcome.reason = result.cancelReason ?? `cancelled by hook "${entry.id}"`;
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[hooks] intercept handler "${entry.id}" on "${name}" failed: ${msg}`);
      }
    }

    return outcome;
  }

  private shouldRun(name: HookName): boolean {
    const entry = getCatalogEntry(name);
    if (!entry) {
      console.error(`[hooks] unknown hook name: ${name}`);
      return false;
    }
    if (entry.status === "reserved") {
      if (process.env.NODE_ENV !== "production" && !reservedWarned.has(name)) {
        reservedWarned.add(name);
        console.warn(
          `[hooks] emit skipped: "${name}" is reserved (feature not implemented yet)`
        );
      }
      return false;
    }
    return isActiveHook(name);
  }
}

export function createHookBus(): HookBus {
  return new HookBus();
}
