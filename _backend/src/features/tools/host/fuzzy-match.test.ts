import { describe, it, expect } from "bun:test";
import { findClosestMatch, formatSuggestion, charSimilarity, FUZZY_MIN_SIMILARITY } from "./fuzzy-match";

describe("charSimilarity", () => {
  it("identical strings score 1", () => {
    expect(charSimilarity("hello world", "hello world")).toBe(1);
  });

  it("prefix match scores proportionally", () => {
    const score = charSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("completely different strings score low", () => {
    expect(charSimilarity("abc", "xyz")).toBe(0);
  });

  it("empty strings handled", () => {
    expect(charSimilarity("", "")).toBe(1);
    expect(charSimilarity("a", "")).toBe(0);
    expect(charSimilarity("", "a")).toBe(0);
  });
});

describe("findClosestMatch", () => {
  const file = `function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}

function bar() {
  const x = 10;
  const y = 20;
  return x * y;
}`;

  it("exact match in file scores 1", () => {
    const oldString = `function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}`;
    const result = findClosestMatch(file, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
    expect(result!.lineStart1Based).toBe(1);
    expect(result!.lineEnd1Based).toBe(5);
  });

  it("indentation drift still matches", () => {
    const oldString = `function foo() {
const a = 1;
const b = 2;
return a + b;
}`;
    const result = findClosestMatch(file, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
    expect(result!.lineStart1Based).toBe(1);
  });

  it("extra blank line handled", () => {
    const oldString = `function foo() {
  const a = 1;

  const b = 2;
  return a + b;
}`;
    const result = findClosestMatch(file, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.7);
    expect(result!.lineStart1Based).toBe(1);
  });

  it("renamed identifier in old_string shows diff", () => {
    const oldString = `function foo() {
  const a = 1;
  const b = 2;
  return a - b;
}`;
    const result = findClosestMatch(file, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.7);
    const suggestion = formatSuggestion(result!, oldString);
    expect(suggestion).toContain("-");
    expect(suggestion).toContain("+");
  });

  it("unrelated content returns null (below threshold)", () => {
    const oldString = `function totallyDifferent() {
  return 42;
}`;
    const result = findClosestMatch(file, oldString);
    expect(result).toBeNull();
  });

  it("repetitive file marks ambiguous", () => {
    const repetitiveFile = `const x = 1;
const x = 1;
const x = 1;
const x = 1;
`;
    const oldString = `const x = 1;`;
    const result = findClosestMatch(repetitiveFile, oldString, { minSimilarity: 0.5 });
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(true);
  });

  it("empty old_string returns null", () => {
    expect(findClosestMatch(file, "")).toBeNull();
  });

  it("empty file returns null", () => {
    expect(findClosestMatch("", "something")).toBeNull();
  });

  it("single-line file uses char fallback", () => {
    const singleLine = "const a = 1; const b = 2; const c = 3;";
    const oldString = "const b = 2;";
    const result = findClosestMatch(singleLine, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it("minified single-line file works", () => {
    const minified = "const a=1;const b=2;const c=3;";
    const oldString = "const b=2;";
    const result = findClosestMatch(minified, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it("large minified file uses strided scan", () => {
    const large = "a".repeat(20000);
    const oldString = "b".repeat(100); // not in file
    const result = findClosestMatch(large, oldString);
    expect(result).toBeNull();
  });

  it("very long old_string in large file returns null quickly", () => {
    const large = "x".repeat(60000);
    const oldString = "y".repeat(5000);
    const result = findClosestMatch(large, oldString);
    expect(result).toBeNull();
  });

  it("whitespace-only difference still matches", () => {
    const fileWs = "const a = 1;\n  const b = 2;";
    const oldString = "const a = 1;\nconst b = 2;";
    const result = findClosestMatch(fileWs, oldString);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.85);
  });
});

describe("formatSuggestion", () => {
  it("includes line numbers and similarity", () => {
    const match = {
      lineStart1Based: 3,
      lineEnd1Based: 7,
      score: 0.92,
      actualLines: ["  const a = 1;", "  const b = 2;", "  return a + b;"],
      ambiguous: false,
    };
    const oldString = "const a = 1;\nconst b = 2;\nreturn a + b;";
    const suggestion = formatSuggestion(match, oldString);
    expect(suggestion).toContain("3-7");
    expect(suggestion).toContain("0.92");
    expect(suggestion).toContain("Re-issue");
  });

  it("shows diff for changed lines", () => {
    const match = {
      lineStart1Based: 1,
      lineEnd1Based: 2,
      score: 0.85,
      actualLines: ["  const a = 1;", "  const b = 2;"],
      ambiguous: false,
    };
    const oldString = "const a = 1;\nconst c = 3;";
    const suggestion = formatSuggestion(match, oldString);
    expect(suggestion).toContain("- const c = 3;");
    expect(suggestion).toContain("+   const b = 2;");
  });

  it("truncates long suggestions", () => {
    const longLines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const match = {
      lineStart1Based: 1,
      lineEnd1Based: 30,
      score: 0.9,
      actualLines: longLines,
      ambiguous: false,
    };
    const oldString = longLines.join("\n");
    const suggestion = formatSuggestion(match, oldString);
    expect(suggestion).toContain("truncated");
    expect(suggestion).toContain("10 more line");
  });

  it("handles single-line match", () => {
    const match = {
      lineStart1Based: 5,
      lineEnd1Based: 5,
      score: 0.95,
      actualLines: ["const x = 42;"],
      ambiguous: false,
    };
    const oldString = "const x = 42;";
    const suggestion = formatSuggestion(match, oldString);
    expect(suggestion).toContain("5-5");
    expect(suggestion).not.toContain("Diff");
  });
});

describe("FUZZY_MIN_SIMILARITY constant", () => {
  it("is configurable via env (tested by reading the constant)", () => {
    // The constant is evaluated at module load; this test just confirms it exists
    expect(typeof FUZZY_MIN_SIMILARITY).toBe("number");
    expect(FUZZY_MIN_SIMILARITY).toBeGreaterThan(0);
    expect(FUZZY_MIN_SIMILARITY).toBeLessThanOrEqual(1);
  });
});
