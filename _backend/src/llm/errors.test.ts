import { describe, expect, test } from "bun:test";
import { classifyLlmError, formatLlmError, extractRawError } from "./errors";

describe("formatLlmError", () => {
  test("connection refused", () => {
    const err = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    const s = formatLlmError(err, { provider: "Local", model: "m" });
    expect(s).toContain("unreachable");
    expect(s).toContain("connection refused");
  });

  test("404 model", () => {
    const s = formatLlmError({ message: "not found", statusCode: 404 }, { provider: "P", model: "M" });
    expect(s).toContain("404");
    expect(s).toContain("not found");
  });
});

describe("classifyLlmError", () => {
  test("401 has custom message and raw for toggle", () => {
    const err = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
      responseBody: '{"error":"invalid_api_key"}',
    });
    const info = classifyLlmError(err, { provider: "OpenCode Zen", model: "big-pickle" });
    expect(info.isCustom).toBe(true);
    expect(info.kind).toBe("auth");
    expect(info.message).toContain("auth error");
    expect(info.message).toContain("OpenCode Zen");
    expect(info.message).toContain("Check API key");
    expect(info.raw).toContain("Unauthorized");
    expect(info.raw).toContain("invalid_api_key");
    expect(info.message).not.toBe(info.raw);
  });

  test("unknown error surfaces raw without inventing a custom body", () => {
    const info = classifyLlmError(new Error("weird provider failure xyz"));
    expect(info.isCustom).toBe(false);
    expect(info.message).toBe("weird provider failure xyz");
    expect(info.raw).toBe("weird provider failure xyz");
  });

  test("socket closed unexpectedly is classified as network and is actionable", () => {
    const err = new Error(
      "Cannot connect to API: The socket connection was closed unexpectedly. " +
        "For more information, pass `verbose: true` in the second argument to fetch()"
    );
    const info = classifyLlmError(err, { provider: "OpenCode Zen", model: "hy3-free" });
    expect(info.kind).toBe("network");
    expect(info.message).toContain("connection dropped");
    expect(info.message).toContain("OpenCode Zen");
    expect(info.isCustom).toBe(true);
    expect(info.raw).toContain("socket connection was closed unexpectedly");
    expect(info.message).not.toBe(info.raw);
  });

  test("extractRawError prefers response body", () => {
    const raw = extractRawError({
      message: "Request failed",
      statusCode: 401,
      responseBody: { error: { message: "bad key" } },
    });
    expect(raw).toContain("Request failed");
    expect(raw).toContain("bad key");
  });
});
