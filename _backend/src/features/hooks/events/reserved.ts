/** Payloads for reserved (not emitted) hooks — keep names stable. */

export interface PromptInjectionDetectedPayload {
  injectionAttempt: string;
  detectedBy: string;
  sessionId?: string;
}

export interface BeforeDataExportPayload {
  exportFormat: string;
  scope: string;
  sessionId?: string;
}

export interface RateLimitApproachPayload {
  currentUsage: number;
  limit: number;
  resetTime?: string;
}
