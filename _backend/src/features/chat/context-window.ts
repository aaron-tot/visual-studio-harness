/**
 * Runtime context window resolution: slider/WS firstTurnNumber + server fallbacks.
 * Single source of truth for which history window is applied at send time.
 */

export type ContextSource = "ws" | "session" | "project" | "global" | "auto" | "none";

export interface ContextScopeConfig {
  // sliding keeps the last N turns; fixed pins to a specific turn (null pin =
  // pinned to the first message = all turns).
  mode?: "sliding" | "fixed" | string;
  firstTurnNumber?: number | null;
  windowSize?: number;
  pinnedTurn?: number | null;
  // Auto compaction (v2): when enabled and the last-turn input context reaches
  // autoCompactionTriggerTokens, the session auto-summarizes and pins to the
  // new summary once the turn completes.
  autoCompactionEnabled?: boolean;
  autoCompactionTriggerTokens?: number;
  enabled?: boolean;
  // "History Included in Context" flags — these control which part types are
  // re-sent from PREVIOUS turns. The current turn always carries everything.
  includeFailedTurnsInHistory?: boolean;
  includeToolCallsInHistory?: boolean;
  includeReasoningInHistory?: boolean;
  includePatchesInHistory?: boolean;
  includeOtherPartsInHistory?: boolean;
}

/** Effective "History Included in Context" flags resolved for a turn. */
export interface HistoryInclusionFlags {
  includeFailedTurnsInHistory: boolean;
  includeToolCallsInHistory: boolean;
  includeReasoningInHistory: boolean;
  includePatchesInHistory: boolean;
  includeOtherPartsInHistory: boolean;
}

export interface ResolveRuntimeFirstTurnInput {
  /** Client-sent value (from store / WS). Wins when non-null. */
  wsFirstTurnNumber?: number | null;
  session?: ContextScopeConfig | null;
  project?: ContextScopeConfig | null;
  global?: ContextScopeConfig | null;
  /** Prior completed turn numbers for this session (exclude the turn being built). */
  completedTurnNumbers: number[];
}

export interface ResolveRuntimeFirstTurnResult {
  firstTurnNumber: number | null;
  source: ContextSource;
}

/**
 * Convert a sliding window size into firstTurnNumber using prior completed turns
 * only. N = keep the last N completed turns (current turn is separate).
 * -1 = all (null), 0 = none (beyond last).
 */
export function computeFirstTurnFromWindowSize(
  completedTurnNumbers: number[],
  windowSize: number,
): number | null {
  const numbers = [...completedTurnNumbers].sort((a, b) => a - b);
  if (windowSize === -1) return null;
  if (numbers.length === 0) {
    if (windowSize === 0) return 1;
    return null;
  }
  const last = numbers[numbers.length - 1]!;
  if (windowSize === 0) return last + 1;
  if (windowSize >= numbers.length) return null;
  return numbers[numbers.length - windowSize] ?? null;
}

function sessionContributes(ctx: ContextScopeConfig | null | undefined): boolean {
  if (!ctx) return false;
  if (ctx.enabled === true) return true;
  if (ctx.autoCompactionEnabled === true) return true;
  // A sliding/fixed pin without `enabled` still owns context.
  if (ctx.mode === "fixed" && ctx.pinnedTurn != null) return true;
  if (ctx.mode === "sliding" && ctx.windowSize != null) return true;
  if (ctx.windowSize != null || ctx.pinnedTurn != null) return true;
  return false;
}

function projectContributes(ctx: ContextScopeConfig | null | undefined): boolean {
  return ctx?.enabled === true;
}

const DEFAULT_WINDOW_SIZE = 10;

function applyScope(
  ctx: ContextScopeConfig,
  completedTurnNumbers: number[],
  source: ContextSource,
): ResolveRuntimeFirstTurnResult | null {
  // Auto compaction owns the boundary and is exclusive with manual sliding.
  if (ctx.autoCompactionEnabled === true) {
    return { firstTurnNumber: ctx.pinnedTurn ?? null, source };
  }
  // Fixed = pinned. pinnedTurn null means pinned to the first message (all turns).
  if (ctx.mode === "fixed") {
    return { firstTurnNumber: ctx.pinnedTurn ?? null, source };
  }
  // Sliding = keep the last windowSize turns.
  if (ctx.mode === "sliding") {
    const size = ctx.windowSize ?? DEFAULT_WINDOW_SIZE;
    return {
      firstTurnNumber: computeFirstTurnFromWindowSize(completedTurnNumbers, size),
      source,
    };
  }
  // Enabled scope with explicit firstTurnNumber even without mode
  if (ctx.firstTurnNumber != null) {
    return { firstTurnNumber: ctx.firstTurnNumber, source };
  }
  return null;
}

/**
 * Resolve firstTurnNumber for a turn:
 * 1. WS client value (if set)
 * 2. Session (if enabled or manual pin)
 * 3. Project (if enabled)
 * 4. Global (always available as base when it has mode/firstTurnNumber)
 */
export function resolveRuntimeFirstTurnNumber(
  input: ResolveRuntimeFirstTurnInput,
): ResolveRuntimeFirstTurnResult {
  if (input.wsFirstTurnNumber != null) {
    return { firstTurnNumber: input.wsFirstTurnNumber, source: "ws" };
  }

  const turns = input.completedTurnNumbers;

  if (sessionContributes(input.session)) {
    const r = applyScope(input.session!, turns, "session");
    if (r) return r;
  }

  if (projectContributes(input.project)) {
    const r = applyScope(input.project!, turns, "project");
    if (r) return r;
  }

  if (input.global && (input.global.mode != null || input.global.firstTurnNumber != null || input.global.windowSize != null || input.global.pinnedTurn != null)) {
    const r = applyScope(input.global, turns, "global");
    if (r) return r;
  }

  return { firstTurnNumber: null, source: "none" };
}

export interface ResolveRuntimeHistoryInclusionInput {
  session?: ContextScopeConfig | null;
  project?: ContextScopeConfig | null;
  global?: ContextScopeConfig | null;
  /** Base values from the chat config; used when no scope sets a field. */
  defaults: HistoryInclusionFlags;
}

/**
 * Resolve the "History Included in Context" flags for a turn using the same
 * precedence as firstTurnNumber: session > project > global, with session and
 * project only contributing when enabled, and global always serving as the
 * base. Fields not set in any scope fall back to the chat-config defaults.
 *
 * NOTE: these flags only govern what is re-sent from PREVIOUS turns. The
 * current turn always includes all part types regardless of these settings.
 */
export function resolveRuntimeHistoryInclusion(
  input: ResolveRuntimeHistoryInclusionInput,
): HistoryInclusionFlags {
  const sessionOn = sessionContributes(input.session);
  const projectOn = projectContributes(input.project);

  const pick = <K extends keyof HistoryInclusionFlags>(key: K): HistoryInclusionFlags[K] => {
    if (sessionOn && input.session && input.session[key] !== undefined) {
      return input.session[key] as HistoryInclusionFlags[K];
    }
    if (projectOn && input.project && input.project[key] !== undefined) {
      return input.project[key] as HistoryInclusionFlags[K];
    }
    if (input.global && input.global[key] !== undefined) {
      return input.global[key] as HistoryInclusionFlags[K];
    }
    return input.defaults[key];
  };

  return {
    includeFailedTurnsInHistory: pick("includeFailedTurnsInHistory"),
    includeToolCallsInHistory: pick("includeToolCallsInHistory"),
    includeReasoningInHistory: pick("includeReasoningInHistory"),
    includePatchesInHistory: pick("includePatchesInHistory"),
    includeOtherPartsInHistory: pick("includeOtherPartsInHistory"),
  };
}
