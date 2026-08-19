import { test, describe, expect } from "bun:test";
import { planChunks, perBlockBudget, clampSafetyMargin, DEFAULT_SAFETY_MARGIN } from "./summary-blocks";

const turn = (content: string) => ({ role: "user" as const, content });

describe("clampSafetyMargin", () => {
  test("uses default for non-number / NaN", () => {
    expect(clampSafetyMargin(null)).toBe(DEFAULT_SAFETY_MARGIN);
    expect(clampSafetyMargin("0.5")).toBe(DEFAULT_SAFETY_MARGIN);
    expect(clampSafetyMargin(NaN)).toBe(DEFAULT_SAFETY_MARGIN);
  });
  test("clamps out-of-range", () => {
    expect(clampSafetyMargin(-1)).toBe(0);
    expect(clampSafetyMargin(5)).toBe(0.9);
  });
  test("keeps valid", () => {
    expect(clampSafetyMargin(0.2)).toBe(0.2);
  });
});

describe("perBlockBudget", () => {
  test("applies margin to max context", () => {
    expect(perBlockBudget(500_000, 0.2)).toBe(400_000);
  });
  test("never below 1", () => {
    expect(perBlockBudget(1, 0.9)).toBe(1);
  });
});

describe("planChunks", () => {
  test("returns [] for no turns", () => {
    expect(planChunks({ turns: [], prioritySummary: null, prompt: "p", budget: 1000 })).toEqual([]);
  });

  test("single block when whole range fits", () => {
    const turns = [turn("one"), turn("two")];
    const chunks = planChunks({ turns, prioritySummary: null, prompt: "", budget: 1000 });
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  });

  test("splits into multiple blocks when range exceeds budget", () => {
    // Each turn is ~19 tokens; budget 50 → ~2 turns/block and >1 block.
    const turns = Array.from({ length: 10 }, (_, i) => turn(`message ${i} ` + "word ".repeat(15)));
    const chunks = planChunks({ turns, prioritySummary: null, prompt: "p", budget: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // Blocks partition the full range, in order, oldest-first.
    let cursor = 0;
    for (const c of chunks) {
      expect(c.startIndex).toBe(cursor);
      expect(c.endIndex).toBeGreaterThanOrEqual(c.startIndex);
      cursor = c.endIndex + 1;
    }
    expect(cursor).toBe(turns.length);
    // Final block reaches the last turn.
    expect(chunks[chunks.length - 1].endIndex).toBe(turns.length - 1);
  });

  test("each block fits under budget (estimatedTokens <= budget)", () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn(`turn ${i} ${"x".repeat(90)}`));
    const chunks = planChunks({ turns, prioritySummary: "prev summary", prompt: "Summarize:", budget: 500 });
    for (const c of chunks) {
      expect(c.estimatedTokens).toBeLessThanOrEqual(500);
    }
  });

  test("prior summary + prompt are included as fixed overhead in every block", () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(`turn ${i}`));
    const noPrior = planChunks({ turns, prioritySummary: null, prompt: "p", budget: 200 });
    const withPrior = planChunks({ turns, prioritySummary: "SOMEWHAT LONG PRIOR SUMMARY TEXT", prompt: "p", budget: 200 });
    // Prior summary reduces capacity → at least as many blocks.
    expect(withPrior.length).toBeGreaterThanOrEqual(noPrior.length);
  });

  test("throws when a single turn exceeds the block payload budget (no silent split)", () => {
    const giant = "z".repeat(50_000); // ~12.5k tokens, far over a small budget
    expect(() => planChunks({ turns: [turn(giant)], prioritySummary: null, prompt: "", budget: 500 })).toThrow();
  });

  test("throws when fixed overhead alone exceeds budget", () => {
    expect(() =>
      planChunks({
        turns: [turn("short")],
        prioritySummary: "x".repeat(10_000),
        prompt: "y".repeat(10_000),
        budget: 50,
      }),
    ).toThrow();
  });
});
