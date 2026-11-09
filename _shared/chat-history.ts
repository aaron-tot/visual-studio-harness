import type { Message } from "./types/message";

/**
 * Number of message bubbles sent per page — both the initial session load and
 * each subsequent "load older" step triggered by scrolling to the top.
 *
 * A "bubble" is one user or assistant message. Error bubbles (failed assistant
 * turns) are still delivered inside a page but do NOT consume the budget, so a
 * page always yields this many *readable* bubbles (when available).
 */
export const CHAT_HISTORY_PAGE = 2;

/** Bounds for the user-configurable page size (config: chatHistoryPageSize). */
export const CHAT_HISTORY_PAGE_MIN = 1;
export const CHAT_HISTORY_PAGE_MAX = 100;

/**
 * Resolve a page size from an untrusted value (config / WS request). Falls back
 * to CHAT_HISTORY_PAGE only when the value is not a finite number, and clamps to
 * the [MIN, MAX] range. Explicit default — not a silent fallback.
 */
export function resolveHistoryPageSize(value?: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CHAT_HISTORY_PAGE;
  return Math.min(CHAT_HISTORY_PAGE_MAX, Math.max(CHAT_HISTORY_PAGE_MIN, Math.floor(value)));
}

/**
 * A bounded window of a session's chat history.
 *
 * Pages are always built from WHOLE turns, so a turn's user/assistant pair (and
 * a summary's marker+user+assistant trio) is never split across a boundary.
 */
export interface ChatHistoryWindow {
  /** Messages in ascending (oldest → newest) display order. */
  messages: Message[];
  /** True when turns older than `cursor` still exist on the server. */
  hasMore: boolean;
  /**
   * Real DB `turn_number` of the oldest turn included in this window. Pass it
   * back as `beforeTurnNumber` to fetch the next older page. `null` when the
   * session has no turns.
   */
  cursor: number | null;
}

/** A conversational bubble: a user or assistant message (system markers excluded). */
export function isMessageBubble(m: Message): boolean {
  return m.role === "user" || m.role === "assistant";
}

/**
 * An error bubble: an assistant message that renders as a failure — a failed
 * turn (`success === false`), an error detail, an `[Error: …]` content prefix,
 * or an `error` part. Such bubbles never count toward the page size.
 */
export function isErrorBubble(m: Message): boolean {
  if (m.role !== "assistant") return false;
  if (m.success === false) return true;
  if (m.errorDetail && m.errorDetail.message) return true;
  if (typeof m.content === "string" && m.content.startsWith("[Error:")) return true;
  return (m.parts ?? []).some((p) => p.type === "error");
}

/** Bubbles that count toward a page: conversational bubbles that are not errors. */
export function isCountedBubble(m: Message): boolean {
  return isMessageBubble(m) && !isErrorBubble(m);
}
