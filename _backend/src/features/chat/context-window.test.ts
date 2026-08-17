import { describe, expect, test } from "bun:test";
import {
  computeFirstTurnFromWindowSize,
  resolveRuntimeFirstTurnNumber,
  resolveRuntimeHistoryInclusion,
  type ContextScopeConfig,
} from "./context-window";
import {
  effectiveFirstTurnFromAnchor,
  snapBoundaryToRanges,
  isSummaryAnchor,
} from "../../../../_shared/types/context";

describe("computeFirstTurnFromWindowSize", () => {
  // Mirrors ContextHistoryLine sliding formula on completed turn numbers.
  // windowSize = N previous completed turns (current turn is not yet in the list).

  test("windowSize=-1 means all turns (null)", () => {
    expect(computeFirstTurnFromWindowSize([1, 2, 3, 4, 5], -1)).toBeNull();
  });

  test("windowSize=0 means none (beyond last)", () => {
    expect(computeFirstTurnFromWindowSize([1, 2, 3], 0)).toBe(4);
  });

  test("windowSize=2 with 5 completed turns keeps last 2", () => {
    // last N means index = length - N
    expect(computeFirstTurnFromWindowSize([1, 2, 3, 4, 5], 2)).toBe(4);
  });

  test("windowSize larger than history yields null (all)", () => {
    expect(computeFirstTurnFromWindowSize([1, 2], 10)).toBeNull();
  });

  test("empty history yields null", () => {
    expect(computeFirstTurnFromWindowSize([], 2)).toBeNull();
  });
});

describe("resolveRuntimeFirstTurnNumber", () => {
  const turns = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  test("WS value wins when provided", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: 5,
      session: { mode: "fixed", pinnedTurn: 8, enabled: true },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 5, source: "ws" });
  });

  test("session fixed pin used when WS null (no enabled required)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: 5, enabled: false },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 5, source: "session" });
  });

  test("session sliding windowSize computes firstTurnNumber when WS null", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "sliding", windowSize: 2, enabled: true },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(8); // last 2 of 9 → starts at 8
    expect(r.source).toBe("session");
  });

  test("falls through to global sliding when session disabled without pin", () => {
    const global: ContextScopeConfig = { mode: "sliding", windowSize: 1 };
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: null, enabled: false },
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
      project: { mode: "sliding", windowSize: 3, enabled: true },
      global: { mode: "sliding", windowSize: 1 },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(7); // last 3
    expect(r.source).toBe("project");
  });

  test("disabled project is ignored; uses global", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: {},
      project: { mode: "sliding", windowSize: 3, enabled: false },
      global: { mode: "sliding", windowSize: 1 },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBe(9);
    expect(r.source).toBe("global");
  });

  test("fixed pin on session preferred over project/global", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: 4 },
      project: { mode: "sliding", windowSize: 2, enabled: true },
      global: { mode: "sliding", windowSize: 1 },
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

  test("sliding windowSize computes last N turns (WS null, no enabled needed)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "sliding", windowSize: 2 },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 8, source: "session" }); // last 2 of 9 → 8
  });

  test("sliding windowSize larger than history yields all turns (null)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "sliding", windowSize: 99 },
      completedTurnNumbers: turns,
    });
    expect(r.firstTurnNumber).toBeNull();
  });

  test("fixed pinnedTurn pins to that turn (WS null, no enabled needed)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: 4 },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 4, source: "session" });
  });

  test("fixed pinnedTurn null (enabled) = pinned to first message = all turns", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: null, enabled: true },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: null, source: "session" });
  });

  test("fixed pinnedTurn null without enabled falls through to none (all)", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { mode: "fixed", pinnedTurn: null },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: null, source: "none" });
  });

  test("global sliding windowSize used as fallback when none of session/project", () => {
    const r = resolveRuntimeFirstTurnNumber({
      wsFirstTurnNumber: null,
      session: { enabled: false },
      global: { mode: "sliding", windowSize: 3 },
      completedTurnNumbers: turns,
    });
    expect(r).toEqual({ firstTurnNumber: 7, source: "global" }); // last 3 of 9 → 7
  });
});

describe("summary anchors (shared helpers)", () => {
  const ranges = [
    { startTurn: 1, endTurn: 7 },
    { startTurn: 9, endTurn: 12 },
  ];

  test("isSummaryAnchor distinguishes live vs summary anchors", () => {
    expect(isSummaryAnchor(7)).toBe(false);
    expect(isSummaryAnchor(7.5)).toBe(true);
    expect(isSummaryAnchor(null)).toBe(false);
  });

  test("effectiveFirstTurnFromAnchor: integer passes through, X.5 -> X+1", () => {
    expect(effectiveFirstTurnFromAnchor(null)).toBeNull();
    expect(effectiveFirstTurnFromAnchor(7)).toBe(7);
    expect(effectiveFirstTurnFromAnchor(7.5)).toBe(8);
    expect(effectiveFirstTurnFromAnchor(12.5)).toBe(13);
  });

  test("snapBoundaryToRanges: integer inside a range snaps to the summary block", () => {
    expect(snapBoundaryToRanges(6, ranges)).toBe(7.5); // inside [1..7]
    expect(snapBoundaryToRanges(1, ranges)).toBe(7.5); // range start
    expect(snapBoundaryToRanges(7, ranges)).toBe(7.5); // range end
  });

  test("snapBoundaryToRanges: outside ranges, summary anchors, and null unchanged", () => {
    expect(snapBoundaryToRanges(8, ranges)).toBe(8); // gap between ranges
    expect(snapBoundaryToRanges(13, ranges)).toBe(13);
    expect(snapBoundaryToRanges(7.5, ranges)).toBe(7.5); // already a summary anchor
    expect(snapBoundaryToRanges(null, ranges)).toBeNull();
  });

  test("snapBoundaryToRanges with empty ranges is identity", () => {
    expect(snapBoundaryToRanges(5, [])).toBe(5);
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

  test("session fixed pin contributes even without enabled", () => {
    const r = resolveRuntimeHistoryInclusion({
      session: { mode: "fixed", pinnedTurn: 4, includeReasoningInHistory: true },
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
