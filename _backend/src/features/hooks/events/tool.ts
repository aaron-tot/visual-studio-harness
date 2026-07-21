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
}
