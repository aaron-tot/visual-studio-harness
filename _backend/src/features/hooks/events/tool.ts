export interface ToolBeforePayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface ToolAfterPayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
  output: unknown;
  isError?: boolean;
}

export interface ToolErrorPayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
  error: string;
  /** Optional structured details (e.g. fuzzy-match suggestion telemetry). */
  metadata?: Record<string, unknown>;
}
