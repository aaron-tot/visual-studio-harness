/**
 * Shared types for the hooks bus.
 * One handler shape for all events; catalog marks observe vs intercept.
 */

export type HookKind = "observe" | "intercept";
export type HookStatus = "active" | "reserved";

export type HookSource = "ws" | "rest" | "internal";

export interface HookContext {
  dataDir: string;
  sessionId?: string;
  workspaceRoot?: string;
  providerName?: string;
  modelName?: string;
  /** Correlation id for one user -> assistant cycle */
  turnId: string;
  signal?: AbortSignal;
  source: HookSource;
}

/** Sparse result; only intercept hooks honor cancel / patch */
export interface HookHandlerResult {
  cancel?: boolean;
  cancelReason?: string;
  patch?: Record<string, unknown>;
}

export interface HookRegisterOptions {
  /** Lower runs first. Default 100. Built-ins: 0-50. */
  priority?: number;
  /** Required for unregister and diagnostics */
  id: string;
}

export interface EmitInterceptOutcome {
  cancelled: boolean;
  reason?: string;
  patch: Record<string, unknown>;
}

export const DEFAULT_HOOK_PRIORITY = 100;
