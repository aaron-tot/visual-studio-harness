import { describe, test, expect, beforeEach } from "bun:test";
import {
  markUserCancelled,
  wasUserCancelled,
  clearUserCancelled,
} from "./session-abort";

describe("user cancelled flag", () => {
  test("clearUserCancelled resets flag for a session", () => {
    markUserCancelled("s1");
    expect(wasUserCancelled("s1")).toBe(true);
    clearUserCancelled("s1");
    expect(wasUserCancelled("s1")).toBe(false);
  });

  test("flag is per-session", () => {
    markUserCancelled("s1");
    expect(wasUserCancelled("s1")).toBe(true);
    expect(wasUserCancelled("s2")).toBe(false);
    clearUserCancelled("s1");
  });
});
