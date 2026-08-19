import { test, describe, expect } from "bun:test";
import { countTokens, estimateMessagesTokens } from "./tokenizer";

describe("countTokens", () => {
  test("returns a deterministic positive count", () => {
    const a = countTokens("Hello world, this is a test summary.");
    const b = countTokens("Hello world, this is a test summary.");
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(b);
  });
  test("longer text has >= tokens (monotonic over same text)", () => {
    const short = countTokens("a");
    const long = countTokens("a" + " b".repeat(500));
    expect(long).toBeGreaterThan(short);
  });
  test("handles empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});

describe("estimateMessagesTokens", () => {
  test("sums framing + content across messages", () => {
    const one = estimateMessagesTokens([{ role: "user", content: "abc" }]);
    const two = estimateMessagesTokens([
      { role: "user", content: "abc" },
      { role: "assistant", content: "def" },
    ]);
    expect(two).toBeGreaterThan(one);
  });
  test("empty array is 0", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
  test("prior summary is included in the estimate", () => {
    const plain = estimateMessagesTokens([{ role: "user", content: "turn" }]);
    const withPrior = estimateMessagesTokens([
      { role: "user", content: "Previous summary:\nSOME PRIOR SUMMARY CONTENT" },
      { role: "user", content: "turn" },
    ]);
    expect(withPrior).toBeGreaterThan(plain);
  });
});
