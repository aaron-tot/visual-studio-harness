import { describe, expect, test } from "bun:test";
import { getRetryableLabel } from "./stream-retry";

describe("getRetryableLabel", () => {
  test("socket closed unexpectedly is retryable", () => {
    const err = new Error(
      "Cannot connect to API: The socket connection was closed unexpectedly. " +
        "For more information, pass `verbose: true` in the second argument to fetch()"
    );
    expect(getRetryableLabel(err)).toBe("connection reset");
  });

  test("econnreset is retryable", () => {
    expect(getRetryableLabel(new Error("read ECONNRESET"))).toBe("connection reset");
  });

  test("connection reset by peer is retryable", () => {
    expect(getRetryableLabel(new Error("Connection reset by peer"))).toBe("connection reset");
  });

  test("socket hang up is retryable", () => {
    expect(getRetryableLabel(new Error("Error: socket hang up"))).toBe("connection reset");
  });

  test("unrelated error is not retryable", () => {
    expect(getRetryableLabel(new Error("weird provider failure xyz"))).toBe(null);
  });

  test("400 is not retryable", () => {
    expect(getRetryableLabel({ statusCode: 400, message: "bad request" })).toBe(null);
  });

  test("429 is retryable", () => {
    expect(getRetryableLabel({ statusCode: 429, message: "rate limited" })).not.toBe(null);
  });

  test("errorName substring match is retryable", () => {
    expect(getRetryableLabel(new Error("Streaming response failed"), "Streaming response failed")).toBe("Streaming response failed");
  });

  test("errorName match is case-insensitive", () => {
    expect(getRetryableLabel(new Error("STREAMING RESPONSE FAILED mid-stream"), "Streaming response failed")).toBe("Streaming response failed");
  });

  test("errorName not present keeps unrelated errors non-retryable", () => {
    expect(getRetryableLabel(new Error("weird provider failure xyz"), "Streaming response failed")).toBe(null);
  });

  test("errorName omitted keeps default behavior", () => {
    expect(getRetryableLabel(new Error("weird provider failure xyz"))).toBe(null);
  });
});
