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
  const e = err as { statusCode?: number; code?: string; message?: string; lastError?: { statusCode?: number; message?: string } };
  const last = e.lastError;
  const code = last?.statusCode ?? e.statusCode;
  const msg = last?.message ?? e.message ?? "";

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
