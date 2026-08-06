export interface StreamRetryConfig {
  /** Number of retries attempted after the initial failure (total attempts = maxAttempts + 1). */
  maxAttempts: number;
  /** Base delay in ms before the first retry; subsequent retries use exponential backoff (delayMs * 2^attempt). */
  delayMs: number;
  /** Error message substring (case-insensitive) that triggers a retry. */
  errorName: string;
}

export const DEFAULT_STREAM_RETRY_CONFIG: StreamRetryConfig = {
  maxAttempts: 3,
  delayMs: 2000,
  errorName: "Streaming response failed",
};

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
