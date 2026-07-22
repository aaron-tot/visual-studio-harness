/**
 * error-delivery.ts
 *
 * Unified error + done delivery for chat WebSocket handlers.
 *
 * Guarantees:
 *   - ALWAYS sends error + done directly to the originating socket
 *     (socket.send() — never depends on session routing)
 *   - ALSO broadcasts via sendToSession for multi-tab listeners
 *   - Always sends a done event so the frontend never hangs on "Thinking"
 *
 * Use `emitErrorAndDone` in every error path (throw, result.error, auto-continue).
 */

import type { WebSocket } from "ws";
import { sendToSession } from "../sessions/view-tracker";
import { classifyLlmError, isAbortError } from "../../llm/errors";
import { chatDebug } from "./debug";

// ── Types ────────────────────────────────────────────────────────────────

export interface ErrorInfo {
  error?: string | null;
  rawError?: string | null;
  errorIsCustom?: boolean | null;
  /** Optional stable category for frontend display routing. */
  category?: ErrorCategory;
}

/** Categories the frontend can use to display errors appropriately. */
export type ErrorCategory =
  | "config"       // Invalid provider/model/config
  | "auth"         // API key / auth failure
  | "network"      // Connection / DNS / timeout
  | "streaming"    // LLM streaming failure
  | "server"       // Backend / provider 5xx
  | "abort"        // User-cancelled
  | "unknown";

// ── Error classification ─────────────────────────────────────────────────

/** Classify any thrown error into a structured ErrorInfo + category. */
export function classifyError(err: unknown, ctx?: { provider?: string; model?: string }): ErrorInfo & { category: ErrorCategory } {
  if (isAbortError(err)) return { category: "abort" };

  const info = classifyLlmError(err, ctx);
  const kind = info.kind;

  let category: ErrorCategory = "unknown";
  if (kind === "auth") category = "auth";
  else if (kind === "not_found") category = "config";
  else if (kind === "unreachable" || kind === "timeout" || kind === "network") category = "network";
  else if (kind === "server") category = "server";

  // Heuristic: "Provider not found" / "Model not found" / "not configured" are config errors
  const msg = (info.message || "").toLowerCase();
  if (category === "unknown" && (msg.includes("provider not found") || msg.includes("model not found") || msg.includes("not configured") || msg.includes("invalid provider") || msg.includes("invalid model"))) {
    category = "config";
  }

  return {
    error: info.message,
    rawError: info.isCustom ? info.raw : undefined,
    errorIsCustom: info.isCustom,
    category,
  };
}

// ── Delivery helpers ─────────────────────────────────────────────────────

function sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === 1 /* OPEN */) {
    socket.send(JSON.stringify(payload));
  }
}

// ── Primary API ──────────────────────────────────────────────────────────

/**
 * Deliver error + done to the originating socket (guaranteed) and to all
 * session listeners (best-effort).
 *
 * Guarantees:
 *   - ALWAYS sends an `error` event (fallback "Unknown error" if empty).
 *   - ALWAYS sends a `done` event so the frontend never hangs on "Thinking".
 *   - Always includes sessionId even when it's "new" (pre-bind).
 *   - Broadcasts via sendToSession for registered sessions only (non-"new").
 *
 * Call this in EVERY error path:
 *   - catch block (throw)
 *   - normal return (result.error)
 *   - auto-continue / continuation turn
 */
export function emitErrorAndDone(
  socket: WebSocket,
  sessionId: string,
  info: ErrorInfo,
  turnId?: number,
): void {
  const { error, rawError, errorIsCustom, category } = info;

  // Always send an error event — never skip. Every error is meaningful.
  // Use a safe fallback so the frontend always gets an error to display.
  const errPayload: Record<string, unknown> = {
    type: "error",
    sessionId,
    error: (error || "Unknown error").trim() || "Unknown error",
    rawError: rawError ?? undefined,
    errorIsCustom: errorIsCustom ?? undefined,
  };
  if (category) errPayload.category = category;
  sendJson(socket, errPayload);

  // Always deliver done so the frontend never hangs on "Thinking".
  sendJson(socket, { type: "done", sessionId, ...(turnId != null ? { turnId } : {}) });

  // ── 2. Broadcast to all session listeners (best-effort) ───────────
  // Only for real registered sessions — "new" has no listeners.
  if (sessionId && sessionId !== "new") {
    const sessionErrPayload: Record<string, unknown> = {
      type: "error",
      sessionId,
      error: (error || "Unknown error").trim() || "Unknown error",
      rawError: rawError ?? undefined,
      errorIsCustom: errorIsCustom ?? undefined,
    };
    if (category) sessionErrPayload.category = category;
    sendToSession(sessionId, sessionErrPayload);
    sendToSession(sessionId, { type: "done", sessionId, ...(turnId != null ? { turnId } : {}) });
  }

  chatDebug("error-delivery", "emitErrorAndDone", {
    sessionId,
    hasError: !!error,
    category,
  });
}

/**
 * Deliver ONLY a done event (for abort / user-cancelled cases where error is
 * not needed, but the frontend must still un-stick).
 */
export function emitDoneOnly(socket: WebSocket, sessionId: string, turnId?: number): void {
  sendJson(socket, { type: "done", sessionId, ...(turnId != null ? { turnId } : {}) });
  if (sessionId && sessionId !== "new") {
    sendToSession(sessionId, { type: "done", sessionId, ...(turnId != null ? { turnId } : {}) });
  }
  chatDebug("error-delivery", "emitDoneOnly", { sessionId });
}
