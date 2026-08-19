import { describe, expect, test } from "bun:test";
import { isPendingAutoCompaction, AutoCompactionBlockedError } from "./auto-compaction";

describe("AutoCompactionBlockedError", () => {
  test("is an Error and carries a message", () => {
    const err = new AutoCompactionBlockedError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AutoCompactionBlockedError);
    expect(err.name).toBe("AutoCompactionBlockedError");
    expect(err.message).toBe("boom");
  });
});

describe("isPendingAutoCompaction", () => {
  const base = {
    enabled: true,
    triggerTokens: 1000,
    lastInputTokens: 1000,
    lastTurnNumber: 5,
    latestSummaryEndTurn: null as number | null,
  };

  test("disabled is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, enabled: false })).toBe(false);
  });

  test("zero / missing trigger is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, triggerTokens: 0 })).toBe(false);
    expect(isPendingAutoCompaction({ ...base, triggerTokens: -1 })).toBe(false);
  });

  test("under threshold is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, lastInputTokens: 999 })).toBe(false);
  });

  test("at threshold with no covering summary is pending", () => {
    expect(isPendingAutoCompaction(base)).toBe(true);
  });

  test("above threshold with no covering summary is pending", () => {
    expect(isPendingAutoCompaction({ ...base, lastInputTokens: 2500 })).toBe(true);
  });

  test("summary that ends on the last live turn is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 5 })).toBe(false);
  });

  test("summary that ends after the last live turn is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 6 })).toBe(false);
  });

  test("summary that ends before the last live turn is still pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 4 })).toBe(true);
  });
});
