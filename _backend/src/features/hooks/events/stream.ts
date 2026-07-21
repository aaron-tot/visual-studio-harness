export interface StreamStartPayload {
  modelName: string;
  providerName?: string;
  messageCount: number;
}

export interface StreamChunkPayload {
  delta: string;
  /** Accumulated text so far in this stream (optional convenience) */
  accumulatedLength: number;
}

export interface StreamEndPayload {
  fullContent: string;
  partCount: number;
  durationMs: number;
}
