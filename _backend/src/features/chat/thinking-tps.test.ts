import { createThinkingTpsTracker } from "./thinking-tps";

const CHARS_PER_TOKEN = 4;

describe("thinking-tps", () => {
  it("returns undefined before start", () => {
    const tracker = createThinkingTpsTracker();
    expect(tracker.isActive()).toBe(false);
    expect(tracker.add("hello", 1000)).toBeUndefined();
    expect(tracker.end(1000)).toBeUndefined();
  });

  it("starts on first delta and returns cumulative rate initially", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("abc", 1000); // 3 chars at t=1000
    // After 1s: 6 chars total (3 from start + 3 from add) / 4 = 1.5 tokens / 1s = 1.5 tps
    expect(tracker.add("def", 2000)).toBeCloseTo(1.5, 1);
    expect(tracker.isActive()).toBe(true);
  });

  it("first 2s uses cumulative fallback", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40), 1000); // 40 chars = 10 tokens at t=1000
    // 1s elapsed: 10 tokens / 1s = 10 tps
    expect(tracker.add("", 2000)).toBeCloseTo(10, 1);
    // 1.5s elapsed: 10 tokens / 1.5s = 6.67 tps
    expect(tracker.add("", 2500)).toBeCloseTo(6.67, 1);
  });

  it("after 2s window, uses rolling window rate", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40), 0); // 40 chars = 10 tokens at t=0
    // 1s: add 40 more chars = 10 more tokens (cumulative 20 tokens)
    tracker.add("a".repeat(40), 1000);
    // 2s: add 40 more chars = 10 more tokens (cumulative 30 tokens)
    tracker.add("a".repeat(40), 2000);
    // 3s: add 40 more chars = 10 more tokens (cumulative 40 tokens)
    // Rolling window: from t=1000 to t=3000 = 20 tokens / 2s = 10 tps
    const tps = tracker.add("a".repeat(40), 3000);
    expect(tps).toBeCloseTo(10, 1);
  });

  it("rolling window prunes old samples", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40), 0); // 10 tokens at t=0
    tracker.add("a".repeat(40), 1000); // +10 (cumulative 20)
    tracker.add("a".repeat(40), 2000); // +10 (cumulative 30)
    // At 3000, samples at t=0 should be pruned (cutoff 1000)
    // Window: 1000-3000: cumulative 80->160 chars = 20 tokens / 2s = 10 tps
    const tps1 = tracker.add("a".repeat(40), 3000); // +10 (cumulative 40)
    expect(tps1).toBeCloseTo(10, 1);
    // At 4000, window 2000-4000: cumulative 120->200 = 80 chars = 20 tokens / 2s = 10 tps
    const tps2 = tracker.add("a".repeat(40), 4000); // +10
    expect(tps2).toBeCloseTo(10, 1);
  });

  it("end returns final avg and deactivates", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40), 0); // 10 tokens
    tracker.add("a".repeat(40), 1000); // +10
    tracker.add("a".repeat(40), 2000); // +10
    const final = tracker.end(3000); // 30 tokens / 3s = 10 tps
    expect(final).toBeCloseTo(10, 1);
    expect(tracker.isActive()).toBe(false);
    expect(tracker.add("more", 4000)).toBeUndefined();
    expect(tracker.end(5000)).toBeUndefined();
  });

  it("handles zero time delta gracefully", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40));
    // Same timestamp - should not crash, return 0
    const tps = tracker.add("more", 1000);
    expect(tps).toBe(0);
  });

  it("handles multiple independent trackers", () => {
    const t1 = createThinkingTpsTracker();
    const t2 = createThinkingTpsTracker();
    t1.start("a".repeat(40), 0);
    t2.start("a".repeat(80), 0);
    expect(t1.add("", 1000)).toBeCloseTo(10, 1);
    expect(t2.add("", 1000)).toBeCloseTo(20, 1);
    t1.end(2000);
    expect(t1.isActive()).toBe(false);
    expect(t2.isActive()).toBe(true);
  });

  it("monotonic time ordering", () => {
    const tracker = createThinkingTpsTracker();
    tracker.start("a".repeat(40));
    tracker.add("b", 1000);
    tracker.add("c", 2000);
    // Out of order time should still work (prunes based on cutoff)
    const tps = tracker.add("d", 1500); // goes back in time, but window handles it
    expect(tps).toBeGreaterThanOrEqual(0);
  });
});
