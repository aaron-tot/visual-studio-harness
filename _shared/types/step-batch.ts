export interface StepToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface StepToolBatchResult extends StepToolCall {
  result?: unknown;
  isError?: boolean;
}

export interface StepToolBatchBeforePayload {
  stepIndex: number;
  toolCalls: StepToolCall[];
}

export interface StepToolBatchAfterPayload {
  stepIndex: number;
  toolCalls: StepToolBatchResult[];
}
