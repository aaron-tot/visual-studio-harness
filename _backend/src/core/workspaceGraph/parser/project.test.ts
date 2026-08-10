import { describe, expect, it } from "bun:test";
import { getParserProject, resetParserProject } from "./project";

describe("parser project singleton", () => {
  it("returns the same instance until reset", () => {
    const a = getParserProject();
    const b = getParserProject();
    expect(a).toBe(b);
  });

  it("returns a fresh instance after reset", () => {
    const a = getParserProject();
    resetParserProject();
    const b = getParserProject();
    expect(b).not.toBe(a);
  });
});
