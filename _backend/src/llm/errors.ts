/** Normalize LLM / HTTP failures into messages the main agent can act on. */

import type { RetryEntry } from "../../../_shared/types";

export interface LlmErrorInfo {
  /** User-facing text (custom mapping when available, else raw). */
  message: string;
  /** Original SDK / HTTP / stack text. */
  raw: string;
  /**
   * True when `message` is a known-pattern custom mapping and differs from raw.
   * UI should show message by default and offer a toggle to raw.
   */
  isCustom: boolean;
  /** Stable category for logging / tests. */
  kind?:
    | "auth"
    | "not_found"
    | "unreachable"
    | "timeout"
    | "network"
    | "server"
    | "http"
    | "unknown";
}

export class LlmError extends Error {
  readonly raw: string;
  readonly isCustom: boolean;
  readonly kind?: LlmErrorInfo["kind"];
  /** Retry log accumulated before this error (set by streamChat before throwing). */
  retries?: RetryEntry[];

  constructor(info: LlmErrorInfo) {
    super(info.message);
    this.name = "LlmError";
    this.raw = info.raw;
    this.isCustom = info.isCustom;
    this.kind = info.kind;
  }

  toInfo(): LlmErrorInfo {
    return {
      message: this.message,
      raw: this.raw,
      isCustom: this.isCustom,
      kind: this.kind,
    };
  }
}

export interface ProviderErrorShape {
  message?: string;
  raw?: string;
  code?: number;
}

interface ProviderErrorLike {
  message?: string;
  lastError?: unknown;
  cause?: unknown;
  response?: { body?: { error?: ProviderErrorShape }; error?: ProviderErrorShape };
  error?: { response?: { body?: { error?: ProviderErrorShape }; error?: ProviderErrorShape } };
  body?: { error?: ProviderErrorShape };
}

/**
 * Pull the provider error JSON out of an SDK/fetch error, walking the nested
 * `lastError`/`cause` chain. Returns null when the error has no provider shape.
 */
export function extractProviderError(err: unknown): ProviderErrorShape | null {
  if (err == null) return null;
  const e = err as ProviderErrorLike;
  const last = (e.lastError as ProviderErrorLike | undefined) ?? (e.cause as ProviderErrorLike | undefined) ?? null;
  return (
    e.response?.body?.error ??
    e.response?.error ??
    last?.response?.body?.error ??
    last?.response?.error ??
    e.error?.response?.body?.error ??
    e.error?.response?.error ??
    e.body?.error ??
    last?.body?.error ??
    (typeof e.message === "string" && e.message.includes("Upstream error from") ? { message: e.message, raw: e.message } : null) ??
    (typeof last?.message === "string" && last.message.includes("Upstream error from") ? { message: last.message, raw: last.message } : null) ??
    null
  );
}

/** Pull the most useful raw string out of an SDK / fetch / HTTP error object. */
export function extractRawError(err: unknown): string {
  if (err == null) return "unknown failure";
  if (typeof err === "string") return err.trim() || "unknown failure";

  const e = err as {
    message?: string;
    cause?: unknown;
    data?: unknown;
    responseBody?: unknown;
    body?: unknown;
    statusCode?: number;
    status?: number;
    code?: string;
    url?: string;
    name?: string;
    stack?: string;
    lastError?: unknown;
  };

  // AI SDK sometimes nests the real failure
  if (e.lastError != null) {
    const nested = extractRawError(e.lastError);
    if (nested && nested !== "unknown failure") return nested;
  }

  const chunks: string[] = [];

  if (e.message) chunks.push(String(e.message));

  if (e.responseBody != null) {
    chunks.push(stringifyBody(e.responseBody));
  } else if (e.body != null) {
    chunks.push(stringifyBody(e.body));
  } else if (e.data != null) {
    chunks.push(stringifyBody(e.data));
  }

  if (e.cause != null) {
    const causeStr =
      e.cause instanceof Error
        ? e.cause.message + (e.cause.stack ? `\n${e.cause.stack}` : "")
        : stringifyBody(e.cause);
    if (causeStr) chunks.push(`cause: ${causeStr}`);
  }

  if (e.code) chunks.push(`code=${e.code}`);
  const status = e.statusCode ?? e.status;
  if (status != null) chunks.push(`status=${status}`);
  if (e.url) chunks.push(`url=${e.url}`);

  const joined = chunks.filter(Boolean).join("\n").trim();
  if (joined) return joined;

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function stringifyBody(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function whereSuffix(ctx?: { provider?: string; model?: string }): string {
  if (!ctx?.provider && !ctx?.model) return "";
  return ` (${[ctx.provider, ctx.model].filter(Boolean).join(" / ")})`;
}

/**
 * Classify an LLM failure into a custom message (when known) plus the raw text.
 * Prefer this over formatLlmError when the UI needs a raw toggle.
 */
export function classifyLlmError(
  err: unknown,
  ctx?: { provider?: string; model?: string }
): LlmErrorInfo {
  if (err instanceof LlmError) return err.toInfo();

  const where = whereSuffix(ctx);
  const raw = extractRawError(err);

  if (err == null) {
    return {
      message: `LLM error${where}: unknown failure`,
      raw,
      isCustom: true,
      kind: "unknown",
    };
  }

  const e = (typeof err === "object" && err !== null ? err : {}) as {
    message?: string;
    cause?: unknown;
    statusCode?: number;
    status?: number;
    code?: string;
  };

  const msg = e.message || (typeof err === "string" ? err : raw);
  const code =
    e.code ||
    (e.cause && typeof e.cause === "object" && e.cause !== null && "code" in e.cause
      ? String((e.cause as { code?: string }).code)
      : undefined);
  const status = e.statusCode ?? e.status;
  const lower = msg.toLowerCase();
  const causeStr =
    e.cause instanceof Error ? e.cause.message : e.cause ? String(e.cause) : "";
  const rawLower = raw.toLowerCase();

  const custom = (message: string, kind: LlmErrorInfo["kind"]): LlmErrorInfo => ({
    message,
    raw,
    isCustom: message.trim() !== raw.trim(),
    kind,
  });

  if (
    code === "ECONNREFUSED" ||
    lower.includes("econnrefused") ||
    causeStr.includes("ECONNREFUSED") ||
    rawLower.includes("econnrefused")
  ) {
    return custom(
      `LLM unreachable${where}: connection refused. ` +
        `The provider server is not running or the base URL is wrong.`,
      "unreachable"
    );
  }

  if (
    code === "ENOTFOUND" ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    rawLower.includes("enotfound") ||
    rawLower.includes("getaddrinfo")
  ) {
    return custom(
      `LLM unreachable${where}: host not found (DNS). Check provider base URL.`,
      "unreachable"
    );
  }

  if (
    code === "ETIMEDOUT" ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    rawLower.includes("timeout") ||
    rawLower.includes("timed out")
  ) {
    return custom(
      `LLM timeout${where}: request timed out. Server may be overloaded or unreachable.`,
      "timeout"
    );
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("connection reset") ||
    lower.includes("socket connection was closed") ||
    lower.includes("closed unexpectedly") ||
    lower.includes("socket hang up") ||
    rawLower.includes("econnreset") ||
    rawLower.includes("connection reset") ||
    rawLower.includes("socket connection was closed") ||
    rawLower.includes("closed unexpectedly")
  ) {
    return custom(
      `LLM connection dropped${where}: the socket was closed unexpectedly. ` +
        `This is usually a transient network issue — retry, or check provider reachability.`,
      "network"
    );
  }

  if (lower.includes("fetch failed") || lower.includes("network") || rawLower.includes("fetch failed")) {
    return custom(
      `LLM network error${where}: ${msg}` +
        (causeStr ? ` (${causeStr})` : "") +
        `. Check that the provider is running and reachable.`,
      "network"
    );
  }

  if (status === 404) {
    return custom(
      `LLM model not found${where} (HTTP 404). ` +
        `The model may not be loaded on the server, or the model id is wrong.`,
      "not_found"
    );
  }

  if (status === 401 || status === 403) {
    return custom(
      `LLM auth error${where} (HTTP ${status}). Check API key.`,
      "auth"
    );
  }

  if (status && status >= 500) {
    return custom(`LLM server error${where} (HTTP ${status}): ${msg}`, "server");
  }

  if (status) {
    // Generic HTTP — include status as light framing but keep raw as primary toggle target
    return custom(`LLM error${where} (HTTP ${status}): ${msg}`, "http");
  }

  // No known pattern — show raw (with provider context only if helpful)
  if (where && !raw.includes(ctx?.provider || "\0")) {
    return {
      message: `LLM error${where}: ${raw}`,
      raw,
      // Light framing counts as custom so user can still see pure raw
      isCustom: true,
      kind: "unknown",
    };
  }

  return {
    message: raw,
    raw,
    isCustom: false,
    kind: "unknown",
  };
}

/** String form for logs / throw sites that only need one string. */
export function formatLlmError(err: unknown, ctx?: { provider?: string; model?: string }): string {
  return classifyLlmError(err, ctx).message;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  return name === "AbortError";
}
