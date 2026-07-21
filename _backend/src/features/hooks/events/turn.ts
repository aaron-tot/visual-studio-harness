import type { Message, SessionMeta } from "../../../../../_shared/types";

export interface TurnStartPayload {
  sessionId: string;
  created: boolean;
  meta: SessionMeta;
  workspaceRoot: string;
}

export interface TurnCompletePayload {
  sessionId: string;
  meta: SessionMeta;
  workspaceRoot: string;
  userMessage: Message;
  assistantMessage: Message | null;
  durationMs: number;
}

export interface TurnErrorPayload {
  sessionId: string;
  error: string;
  durationMs: number;
}
