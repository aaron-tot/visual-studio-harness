export interface SessionAbortPayload {
  sessionId: string;
  reason: "user_cancel" | "socket_close" | "other";
}

/** Reserved: history truncation / context compression not built yet */
export interface HistoryTruncatedPayload {
  sessionId: string;
  truncatedTurnCount: number;
  remainingTokens?: number;
}
