import { EMBEDDING_RETRIES, EMBEDDING_TIMEOUT_MS } from "../constants";

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

export interface RetryableError extends Error {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Network failures (fetch throws TypeError on connection reset, DNS, etc.)
  if (err instanceof TypeError) return true;

  const status = (err as RetryableError).status;
  if (status !== undefined) {
    // 429 Too Many Requests and 5xx are transient. 4xx are permanent.
    return status === 429 || status >= 500;
  }

  // Timeout/abort errors from AbortSignal.timeout
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;

  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a transient operation with exponential backoff + jitter.
 * Honors Retry-After on 429 responses. Only retries retryable errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? EMBEDDING_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 8_000;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err: any) {
      attempt += 1;
      if (attempt > retries || !isRetryable(err)) throw err;

      const retryAfter = (err as RetryableError)?.retryAfterMs;
      let delay: number;
      if (retryAfter && retryAfter > 0) {
        delay = Math.min(retryAfter, maxDelayMs);
      } else {
        const backoff = baseDelayMs * 2 ** (attempt - 1);
        delay = Math.min(backoff + Math.random() * baseDelayMs, maxDelayMs);
      }

      console.warn(
        `[knowledge] embed attempt ${attempt}/${retries} failed (${err?.message ?? err}); retrying in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }
}
