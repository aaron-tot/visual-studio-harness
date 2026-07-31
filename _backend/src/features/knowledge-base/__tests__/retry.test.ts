import { describe, it, expect } from "bun:test";
import { withRetry, isRetryable, sleep } from "../embedding/retry";

describe("withRetry", () => {
  it("retries transient 429 errors and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) {
        const err: any = new Error("Too many requests");
        err.status = 429;
        throw err;
      }
      return "ok";
    }, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retries 5xx errors", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 2) {
        const err: any = new Error("Gateway timeout");
        err.status = 502;
        throw err;
      }
      return "ok";
    }, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry permanent 4xx errors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        const err: any = new Error("Unauthorized");
        err.status = 401;
        throw err;
      }, { retries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("Unauthorized");
    expect(calls).toBe(1);
  });

  it("gives up after retries are exhausted", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        const err: any = new Error("boom");
        err.status = 503;
        throw err;
      }, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("retries network (TypeError) failures", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 2) throw new TypeError("fetch failed");
      return "ok";
    }, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("isRetryable", () => {
  it("classifies status codes", () => {
    const mk = (status: number) => {
      const e: any = new Error("x");
      e.status = status;
      return e;
    };
    expect(isRetryable(mk(429))).toBe(true);
    expect(isRetryable(mk(500))).toBe(true);
    expect(isRetryable(mk(503))).toBe(true);
    expect(isRetryable(mk(400))).toBe(false);
    expect(isRetryable(mk(401))).toBe(false);
    expect(isRetryable(mk(404))).toBe(false);
  });

  it("classifies network and timeout errors as retryable", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    expect(isRetryable(timeoutErr)).toBe(true);
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    expect(isRetryable(abortErr)).toBe(true);
    expect(isRetryable(new Error("random"))).toBe(false);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    const start = Date.now();
    await sleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });
});
