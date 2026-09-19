import { describe, expect, test } from "bun:test";
import { errorPartTitle, isRecovered } from "./ErrorLogPart";
import type { RetryEntry } from "../../../../../_shared/types";

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

describe("errorPartTitle", () => {
  test("uses 'Recovered after N retries' when recovered", () => {
    expect(errorPartTitle({ recovered: true, nRetries: 3, providerName: "openrouter" })).toBe("Recovered after 3 retries");
    expect(errorPartTitle({ recovered: true, nRetries: 1 })).toBe("Recovered after 1 retry");
  });

  test("labels local network errors as Connection/Timeout, not Upstream Provider", () => {
    expect(errorPartTitle({ recovered: false, nRetries: 0, category: "network", providerName: "openrouter" })).toBe("Connection / Timeout Error");
    expect(errorPartTitle({ recovered: false, nRetries: 0, category: "network" })).toBe("Connection / Timeout Error");
  });

  test("uses Upstream Provider label for non-network errors", () => {
    expect(errorPartTitle({ recovered: false, nRetries: 0, category: "server", providerName: "openrouter" })).toBe("Upstream Provider (openrouter) Error");
    expect(errorPartTitle({ recovered: false, nRetries: 0 })).toBe("Upstream Provider Error");
  });
});
