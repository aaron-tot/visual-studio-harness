import { describe, expect, test } from "bun:test";
import {
  computeFirstTurnFromMaxTurns,
  resolveRuntimeFirstTurnNumber,
  resolveRuntimeHistoryInclusion,
  type ContextScopeConfig,
} from "./context-window";

describe("computeFirstTurnFromMaxTurns", () => {
  // Mirrors ContextHistoryLine auto-mode formula on completed turn numbers.
  // maxTurns = N previous completed turns (current turn is not yet in the list).

  test("maxTurns=-1 means all turns (null)", () => {
    expect(computeFirstTurnFromMaxTurns([1, 2, 3, 4, 5], -1)).toBeNull();
  });

  test("maxTurns=0 means none (beyond last)", () => {
    expect(computeFirstTurnFromMaxTurns([1, 2, 3], 0)).toBe(4);
  });

  test("maxTurns=2 with 5 completed turns keeps last 2", () => {
    // numbers=[1..5], idx = 5 - 2 - 1 = 2 → turn 3, but UI uses length - N - 1
    // waiting for current: with only completed turns, last N means index = length - N
    expect(computeFirstTurnFromMaxTurns([1, 2, 3, 4, 5], 2)).toBe(4);
  });

  test("maxTurns larger than history yields null (all)", () => {
    expect(computeFirstTurnFromMaxTurns([1, 2], 10)).toBeNull();
  });

  test("empty history yields null", () => {
    expect(computeFirstTurnFromMaxTurns([], 2)).toBeNull();
  });
});

describe("resolveRuntimeFirstTurnNumber", () => {
  const turns = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  test("WS value wins when provided", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: 5,
      session: { mode: "manual", firstTurnNumber: 8, enabled: true },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 5, source: "ws" });
  });

  test("session manual pin used when WS null (no enabled required)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "manual", firstTurnNumber: 5, enabled: false },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 5, source: "session" });
  });

  test("session auto maxTurns computes firstTurnNumber when WS null", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "auto", maxTurns: 2, enabled: true },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(8); // last 2 of 9 → starts at 8
    expect(r.source).toBe("session");
  });

  test("falls through to global auto when session disabled without pin", () => {
    const global: ContextScopeConfig = { mode: "auto", maxTurns: 1 };
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "manual", enabled: false },
      global,
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(9); // last 1
    expect(r.source).toBe("global");
  });

  test("enabled project overrides global when session inactive", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { enabled: false },
      project: { mode: "auto", maxTurns: 3, enabled: true },
      global: { mode: "auto", maxTurns: 1 },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(7); // last 3
    expect(r.source).toBe("project");
  });

  test("disabled project is ignored; uses global", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: {},
      project: { mode: "auto", maxTurns: 3, enabled: false },
      global: { mode: "auto", maxTurns: 1 },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(9);
    expect(r.source).toBe("global");
  });

  test("manual pin on session preferred over project/global", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "manual", firstTurnNumber: 4 },
      project: { mode: "auto", maxTurns: 2, enabled: true },
      global: { mode: "auto", maxTurns: 1 },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 4, source: "session" });
  });

  test("none when no scopes contribute", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: null, source: "none" });
  });
});

describe("resolveRuntimeHistoryInclusion", () => {
  const defaults = {
    includeFailedTurnsInHistory: true,
    includeToolCallsInHistory: true,
    includeReasoningInHistory: false,
    includePatchesInHistory: false,
    includeOtherPartsInHistory: false,
  };

  test("falls back to defaults when no scope sets a field", () => {
    const r = resolveRuntimeHistoryInclusion({ defaults });
    expect(r).toEqual(defaults);
    expect(r.includeReasoningInHistory).toBe(false);
  });

  test("global value is picked as the base", () => {
    const r = resolveRuntimeHistoryInclusion({
      global: { includeReasoningInHistory: true },
      defaults,
    });
    expect(r.includeReasoningInHistory).toBe(true);
  });

  test("enabled session overrides global", () => {
    const r = resolveRuntimeHistoryInclusion({
      session: { includeReasoningInHistory: false, enabled: true },
      global: { includeReasoningInHistory: true },
      defaults,
    });
    expect(r.includeReasoningInHistory).toBe(false);
  });

  test("session manual pin contributes even without enabled", () => {
    const r = resolveRuntimeHistoryInclusion({
      session: { mode: "manual", firstTurnNumber: 4, includeReasoningInHistory: true },
      global: { includeReasoningInHistory: false },
      defaults,
    });
    expect(r.includeReasoningInHistory).toBe(true);
  });

  test("disabled session ignored; enabled project overrides global", () => {
    const r = resolveRuntimeHistoryInclusion({
      session: { includeReasoningInHistory: true, enabled: false },
      project: { includeReasoningInHistory: false, enabled: true },
      global: { includeReasoningInHistory: true },
      defaults,
    });
    expect(r.includeReasoningInHistory).toBe(false);
    expect(r.includeToolCallsInHistory).toBe(true);
  });

  test("disabled project ignored; falls through to global", () => {
    const r = resolveRuntimeHistoryInclusion({
      project: { includeReasoningInHistory: false, enabled: false },
      global: { includeReasoningInHistory: true },
      defaults,
    });
    expect(r.includeReasoningInHistory).toBe(true);
  });
});
