import { describe, expect, test } from "bun:test";
import { isRecovered } from "./ErrorLogPart";
import type { RetryEntry } from "../../../_shared/types";

function entry(status: RetryEntry["status"]): RetryEntry {
  return {
    attempt: 1,
    maxAttempts: 3,
    message: "connection reset",
    errorLabel: "connection reset",
    errorCode: null,
    errorTime: new Date().toISOString(),
    delayMs: 2000,
    wasRetried: true,
    status,
  };
}

describe("isRecovered", () => {
  test("true when the last retry entry succeeded", () => {
    expect(isRecovered([entry("failed"), entry("succeeded")])).toBe(true);
  });

  test("false when the last retry entry failed or is pending", () => {
    expect(isRecovered([entry("failed")])).toBe(false);
    expect(isRecovered([entry("pending")])).toBe(false);
    expect(isRecovered([entry("aborted")])).toBe(false);
  });

  test("false when there are no retries", () => {
    expect(isRecovered(undefined)).toBe(false);
    expect(isRecovered([])).toBe(false);
  });
});
