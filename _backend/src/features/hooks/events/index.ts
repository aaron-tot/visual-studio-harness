import type {
  MessageReceivedPayload,
  MessageUserPersistedPayload,
  MessageEditPayload,
} from "./message";
import type { TurnStartPayload, TurnCompletePayload, TurnErrorPayload } from "./turn";
import type { StreamStartPayload, StreamChunkPayload, StreamEndPayload } from "./stream";
import type { ToolBeforePayload, ToolAfterPayload, ToolErrorPayload } from "./tool";
import type { SessionAbortPayload, HistoryTruncatedPayload } from "./session";
import type {
  PromptInjectionDetectedPayload,
  BeforeDataExportPayload,
  RateLimitApproachPayload,
} from "./reserved";

/**
 * Active + reserved hook names and their payloads.
 * Adding a hook: add name here, catalog entry, event file, then emit site.
 */
export interface HookPayloadMap {
  // --- active (V1 wire targets) ---
  "message.received": MessageReceivedPayload;
  "message.user_persisted": MessageUserPersistedPayload;
  "turn.start": TurnStartPayload;
  "turn.complete": TurnCompletePayload;
  "turn.error": TurnErrorPayload;
  "stream.start": StreamStartPayload;
  "stream.chunk": StreamChunkPayload;
  "stream.end": StreamEndPayload;
  "tool.before": ToolBeforePayload;
  "tool.after": ToolAfterPayload;
  "tool.error": ToolErrorPayload;
  "session.abort": SessionAbortPayload;

  // --- reserved (feature not built; do not emit) ---
  "message.edit": MessageEditPayload;
  "history.truncated": HistoryTruncatedPayload;
  "security.prompt_injection": PromptInjectionDetectedPayload;
  "export.before": BeforeDataExportPayload;
  "limits.rate_approach": RateLimitApproachPayload;
}

export type HookName = keyof HookPayloadMap;

export type {
  MessageReceivedPayload,
  MessageUserPersistedPayload,
  MessageEditPayload,
  TurnStartPayload,
  TurnCompletePayload,
  TurnErrorPayload,
  StreamStartPayload,
  StreamChunkPayload,
  StreamEndPayload,
  ToolBeforePayload,
  ToolAfterPayload,
  ToolErrorPayload,
  SessionAbortPayload,
  HistoryTruncatedPayload,
  PromptInjectionDetectedPayload,
  BeforeDataExportPayload,
  RateLimitApproachPayload,
};
