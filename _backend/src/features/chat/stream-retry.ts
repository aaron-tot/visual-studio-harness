export interface StreamRetryConfig {
  /** Number of retries attempted after the initial failure (total attempts = maxAttempts + 1). */
  maxAttempts: number;
  /** Base delay in ms before the first retry. */
  baseDelayMs: number;
  /** Additional delay per retry (ms). 0 = no progressive increase.
   *  Example: baseDelayMs=2000, progressiveDelayMs=3000 -> 2s, 5s, 8s, 11s... */
  progressiveDelayMs: number;
  /** Error message substring (case-insensitive) that triggers a retry. */
  errorName: string;
  /** Time window for retry rate limiting */
  windowValue: number;
  windowUnit: "seconds" | "minutes" | "hours";
}

export const DEFAULT_STREAM_RETRY_CONFIG: StreamRetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  progressiveDelayMs: 3000,
  errorName: "Streaming response failed",
  windowValue: 1,
  windowUnit: "minutes",
};

const WINDOW_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
};

/** Calculate delay for a given attempt (0-indexed) with progressive increase. */
export function calculateRetryDelay(attempt: number, baseDelayMs: number, progressiveDelayMs: number): number {
  return baseDelayMs + attempt * progressiveDelayMs;
}

/** Check if we can retry within the rate limit window (mirrors auto-continue logic). */
export function canRetryInWindow(
  map: Map<string, number[]>,
  key: string,
  maxAttempts: number,
  windowValue: number,
  windowUnit: "seconds" | "minutes" | "hours"
): boolean {
  const windowMs = windowValue * (WINDOW_MS[windowUnit] ?? 60000);
  const now = Date.now();
  let attempts = map.get(key) ?? [];
  attempts = attempts.filter((t) => now - t < windowMs);
  if (attempts.length === 0) {
    map.delete(key);
    return true;
  }
  map.set(key, attempts);
  return attempts.length < maxAttempts;
}

/** Record a retry attempt for rate limiting. */
export function recordRetryAttempt(map: Map<string, number[]>, key: string): void {
  const attempts = map.get(key) ?? [];
  attempts.push(Date.now());
  map.set(key, attempts);
}

export function getRetryableLabel(err: unknown, errorName?: string): string | null {
  if (!err) return null;

  // Normalize various error shapes to extract code and message
  const e = err as Record<string, unknown>;
  const last = (e.lastError as Record<string, unknown>) ?? (e.cause as Record<string, unknown>) ?? null;

  // Try multiple locations for status code
  const code =
    (typeof last?.statusCode === "number" ? last.statusCode : null) ??
    (typeof e.statusCode === "number" ? e.statusCode : null) ??
    (typeof e.status === "number" ? e.status : null) ??
    (typeof last?.status === "number" ? last.status : null) ??
    null;

  // Try multiple locations for message - use helper that skips empty strings
  const getMsg = (val: unknown): string | null =>
    typeof val === "string" && val.length > 0 ? val : null;

  const msg =
    getMsg(last?.message) ??
    getMsg(e.message) ??
    getMsg(last?.error) ??
    getMsg(e.error) ??
    (err instanceof Error ? getMsg(err.message) : null) ??
    String(err);

  if (code === 429 || (code && code >= 500) || code === 408 || code === 409) return `${msg}`;

  const low = msg.toLowerCase();
  if (e.code === "ECONNREFUSED" || low.includes("econnrefused")) return "connection refused";
  if (e.code === "ENOTFOUND" || low.includes("enotfound")) return "host not found";
  if (e.code === "ETIMEDOUT" || low.includes("timeout")) return "timeout";
  if (low.includes("fetch failed") || low.includes("network")) return "network error";
  if (
    low.includes("econnreset") ||
    low.includes("connection reset") ||
    low.includes("socket connection was closed") ||
    low.includes("closed unexpectedly") ||
    low.includes("socket hang up")
  )
    return "connection reset";

  if (errorName && low.includes(errorName.toLowerCase())) return errorName;

  return null;
}
