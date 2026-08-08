/**
 * Runtime context window resolution: slider/WS firstTurnNumber + server fallbacks.
 * Single source of truth for which history window is applied at send time.
 */

export type ContextSource = "ws" | "session" | "project" | "global" | "auto" | "none";

export interface ContextScopeConfig {
  mode?: "auto" | "manual" | string;
  maxTurns?: number;
  firstTurnNumber?: number | null;
  manualMode?: "turnsBack" | "pinned" | string;
  manualTurnsBack?: number;
  enabled?: boolean;
  // "History Included in Context" flags — these control which part types are
  // re-sent from PREVIOUS turns. The current turn always carries everything.
  includeFailedTurnsInHistory?: boolean;
  includeToolCallsInHistory?: boolean;
  includeReasoningInHistory?: boolean;
  includePatchesInHistory?: boolean;
  includeOtherPartsInHistory?: boolean;
  contextMaxTurns?: number;
}

/** Effective "History Included in Context" flags resolved for a turn. */
export interface HistoryInclusionFlags {
  includeFailedTurnsInHistory: boolean;
  includeToolCallsInHistory: boolean;
  includeReasoningInHistory: boolean;
  includePatchesInHistory: boolean;
  includeOtherPartsInHistory: boolean;
  contextMaxTurns?: number;
}

export interface ResolveRuntimeFirstTurnInput {
  /** Client-sent value (from store / WS). Wins when non-null. */
  wsFirstTurnNumber?: number | null;
  session?: ContextScopeConfig | null;
  project?: ContextScopeConfig | null;
  global?: ContextScopeConfig | null;
  /**
   * Prior completed turn numbers for this session (exclude the turn being built).
   * Used to convert auto maxTurns → firstTurnNumber.
   */
  completedTurnNumbers: number[];
}

export interface ResolveRuntimeFirstTurnResult {
  firstTurnNumber: number | null;
  source: ContextSource;
}

/**
 * Convert auto maxTurns into firstTurnNumber using prior completed turns only.
 * maxTurns = N means keep the last N completed turns (current turn is separate).
 * -1 = all (null), 0 = none (beyond last).
 */
export function computeFirstTurnFromMaxTurns(
  completedTurnNumbers: number[],
  maxTurns: number,
): number | null {
  const numbers = [...completedTurnNumbers].sort((a, b) => a - b);
  if (maxTurns === -1) return null;
  if (numbers.length === 0) {
    if (maxTurns === 0) return 1;
    return null;
  }
  const last = numbers[numbers.length - 1]!;
  if (maxTurns === 0) return last + 1;
  if (maxTurns >= numbers.length) return null;
  return numbers[numbers.length - maxTurns] ?? null;
}

function sessionContributes(ctx: ContextScopeConfig | null | undefined): boolean {
  if (!ctx) return false;
  if (ctx.enabled === true) return true;
  // Migration: manual pin without enabled still owns context (audit Fix A2 / B)
  if (ctx.mode === "manual" && ctx.firstTurnNumber != null) return true;
  return false;
}

function projectContributes(ctx: ContextScopeConfig | null | undefined): boolean {
  return ctx?.enabled === true;
}

function applyScope(
  ctx: ContextScopeConfig,
  completedTurnNumbers: number[],
  source: ContextSource,
): ResolveRuntimeFirstTurnResult | null {
  if (ctx.mode === "manual" && ctx.firstTurnNumber != null) {
    return { firstTurnNumber: ctx.firstTurnNumber, source };
  }
  if (ctx.mode === "auto" && ctx.maxTurns != null) {
    return {
      firstTurnNumber: computeFirstTurnFromMaxTurns(completedTurnNumbers, ctx.maxTurns),
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
 * 4. Global (always available as base when it has mode/maxTurns/firstTurnNumber)
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

  if (input.global && (input.global.mode != null || input.global.maxTurns != null || input.global.firstTurnNumber != null)) {
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
    contextMaxTurns: pick("contextMaxTurns"),
  };
}
