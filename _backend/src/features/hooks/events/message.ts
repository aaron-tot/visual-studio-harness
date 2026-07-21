import type { Message } from "../../../../../_shared/types";

export interface MessageReceivedPayload {
  content: string;
  sessionId?: string | null;
}

export interface MessageUserPersistedPayload {
  message: Message;
  sessionId: string;
}

/** Reserved: message edit feature not built yet */
export interface MessageEditPayload {
  messageId: string;
  oldContent: string;
  newContent: string;
  sessionId: string;
}
