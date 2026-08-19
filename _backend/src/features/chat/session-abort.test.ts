import { describe, test, expect, beforeEach } from "bun:test";
import {
  markUserCancelled,
  wasUserCancelled,
  clearUserCancelled,
  abortAllActiveSessions,
  getSessionAborts,
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

describe("abortAllActiveSessions", () => {
  beforeEach(() => {
    getSessionAborts().clear();
  });

  test("aborts every registered session and returns their ids", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    getSessionAborts().set("s1", c1);
    getSessionAborts().set("s2", c2);

    const aborted = abortAllActiveSessions();

    expect(aborted.sort()).toEqual(["s1", "s2"]);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(getSessionAborts().size).toBe(0);
  });

  test("no sessions registered => nothing to abort", () => {
    expect(abortAllActiveSessions()).toEqual([]);
  });
});
