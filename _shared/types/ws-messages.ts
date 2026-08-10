/**
 * WebSocket message types for chat streaming
 * Shared between backend and frontend
 */

// Base message with sessionId
export interface BaseWsMessage {
  sessionId: string;
}

// Token delta
export interface TokenMessage extends BaseWsMessage {
  type: "token";
  content: string;
  seq?: number;
  /** Live tokens-per-second estimate (chars/4), calculated by VSH during streaming. */
  tps?: number;
}

// Reasoning delta
export interface ReasoningMessage extends BaseWsMessage {
  type: "reasoning";
  content: string;
  seq?: number;
  /** Live tokens-per-second estimate (chars/4), calculated by VSH during streaming. */
  tps?: number;
}

// Tool call started
export interface ToolStartMessage extends BaseWsMessage {
  type: "tool_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
  stepIndex?: number;
  seq?: number;
  parentToolCallId?: string;
}

// Tool call update (status change)
export interface ToolUpdateMessage extends BaseWsMessage {
  type: "tool_update";
  toolCallId: string;
  status: string;
  partial?: unknown;
  seq?: number;
}

// Tool call ended
export interface ToolEndMessage extends BaseWsMessage {
  type: "tool_end";
  toolCallId: string;
  status: "completed" | "error";
  result?: unknown;
  error?: string;
  seq?: number;
  turnId?: number;
}

// Stream pulse (heartbeat)
export interface StreamPulseMessage extends BaseWsMessage {
  type: "stream_pulse";
}

// Permission request
export interface PermissionRequestMessage extends BaseWsMessage {
  type: "permission_request";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

// Subagent config request
export interface SubagentConfigRequestMessage extends BaseWsMessage {
  type: "subagent_config_request";
  requestId: string;
  toolCallId?: string;
  reason: string;
  suggestedProvider?: string;
  suggestedModel?: string;
}

// Slot busy request
export interface SlotBusyRequestMessage extends BaseWsMessage {
  type: "slot_busy_request";
  requestId: string;
  toolCallId?: string;
  detail: string;
  free: number;
  total: number;
  modelAlias?: string;
  baseUrl?: string;
  defaultPollIntervalSec?: number;
  defaultWaitTimeoutSec?: number;
}

// Agent change request
export interface AgentChangeRequestMessage extends BaseWsMessage {
  type: "agent_change_request";
  requestId: string;
  toolCallId?: string;
  suggestedAgent: string;
  reason: string;
  agents: string[];
}

// Slot wait started
export interface SlotWaitStartedMessage extends BaseWsMessage {
  type: "slot_wait_started";
  requestId: string;
  toolCallId?: string;
  detail: string;
  free: number;
  total: number;
  modelAlias?: string;
  pollIntervalSec?: number;
  waitTimeoutSec?: number;
}

// Slot wait status update
export interface SlotWaitStatusMessage extends BaseWsMessage {
  type: "slot_wait_status";
  requestId: string;
  message: string;
}

// Slot wait ended
export interface SlotWaitEndedMessage extends BaseWsMessage {
  type: "slot_wait_ended";
  requestId: string;
}

// Session created
export interface SessionCreatedMessage {
  type: "session_created";
  session: {
    id: string;
    title: string;
    providerName: string;
    modelName: string;
    thinkingEffort: string;
    workspaceRoot: string;
    created: string;
    updated: string;
    kind: string;
    parentId?: string;
    taskLabel?: string;
    agentName?: string;
  };
}

// Session state (for rehydration)
export interface SessionStateMessage extends BaseWsMessage {
  type: "session_state";
  history?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    parts?: Array<{ type: string; [key: string]: unknown }>;
    timestamp: string;
    agentName?: string;
    modelName?: string;
    providerName?: string;
    durationMs?: number;
    turnId?: number;
    success?: boolean;
    errorDetail?: { message: string; raw?: string; isCustom?: boolean };
  }>;
  meta?: {
    id: string;
    title: string;
    providerName: string;
    modelName: string;
    thinkingEffort: string;
    workspaceRoot: string;
    created: string;
    updated: string;
    kind: string;
    parentId?: string;
    taskLabel?: string;
    agentName?: string;
  };
  upToSeq?: number;
  requestId?: number;
  streaming?: string | null;
}

// Session updated
export interface SessionUpdatedMessage {
  type: "session_updated";
  session: {
    id: string;
    title: string;
    providerName: string;
    modelName: string;
    thinkingEffort: string;
    workspaceRoot: string;
    created: string;
    updated: string;
    kind: string;
    parentId?: string;
    taskLabel?: string;
    agentName?: string;
  };
}

// Session stream start
export interface SessionStreamStartMessage extends BaseWsMessage {
  type: "session_stream_start";
}

// Session stream end
export interface SessionStreamEndMessage extends BaseWsMessage {
  type: "session_stream_end";
  success: boolean;
}

// Error message
export interface ErrorMessage extends BaseWsMessage {
  type: "error";
  error: string;
  rawError?: string;
  errorIsCustom?: boolean;
  modelName?: string;
  providerName?: string;
  durationMs?: number;
  turnId?: number;
  agentName?: string;
  status?: string;
  category?: string;
}

// Done message (turn complete)
export interface DoneMessage extends BaseWsMessage {
  type: "done";
  modelName?: string;
  providerName?: string;
  durationMs?: number;
  turnId?: number;
  agentName?: string;
}

// Step tool batch start
export interface StepToolStartMessage extends BaseWsMessage {
  type: "step_tool_start";
  stepIndex: number;
  toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
}

// Step tool batch end
export interface StepToolEndMessage extends BaseWsMessage {
  type: "step_tool_end";
  stepIndex: number;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    result?: unknown;
    status: "completed" | "error";
  }>;
}

// Thinking phase ended (first text/tool/finish-step after reasoning deltas)
export interface ThinkingEndMessage extends BaseWsMessage {
  type: "thinking_end";
}

// ─── Retry Countdown Messages ───

/** Emitted when a retry attempt begins */
export interface RetryStartMessage extends BaseWsMessage {
  type: "retry_start";
  attempt: number;           // 1-indexed attempt number
  maxAttempts: number;       // Total max retries configured
  totalDelayMs: number;      // Total delay for this attempt
  errorLabel: string;        // Human-readable error label (e.g., "timeout", "503 Service Unavailable")
}

/** Emitted every ~1s during retry wait with updated remaining time */
export interface RetryTickMessage extends BaseWsMessage {
  type: "retry_tick";
  remainingMs: number;       // Milliseconds remaining until retry
}

/** Emitted when retry wait ends (either completed or aborted) */
export interface RetryEndMessage extends BaseWsMessage {
  type: "retry_end";
  aborted: boolean;          // True if wait was cut short by abort/cancel
}

// Union of all message types
export type WsMessage =
  | TokenMessage
  | ReasoningMessage
  | ToolStartMessage
  | ToolUpdateMessage
  | ToolEndMessage
  | StreamPulseMessage
  | PermissionRequestMessage
  | SubagentConfigRequestMessage
  | SlotBusyRequestMessage
  | AgentChangeRequestMessage
  | SlotWaitStartedMessage
  | SlotWaitStatusMessage
  | SlotWaitEndedMessage
  | SessionCreatedMessage
  | SessionStateMessage
  | SessionUpdatedMessage
  | SessionStreamStartMessage
  | SessionStreamEndMessage
  | ErrorMessage
  | DoneMessage
  | StepToolStartMessage
  | StepToolEndMessage
  | ThinkingEndMessage
  | RetryStartMessage
  | RetryTickMessage
  | RetryEndMessage;

// Type guards
export function isRetryStartMessage(msg: WsMessage): msg is RetryStartMessage {
  return msg.type === "retry_start";
}

export function isRetryTickMessage(msg: WsMessage): msg is RetryTickMessage {
  return msg.type === "retry_tick";
}

export function isRetryEndMessage(msg: WsMessage): msg is RetryEndMessage {
  return msg.type === "retry_end";
}

export function isRetryMessage(msg: WsMessage): msg is RetryStartMessage | RetryTickMessage | RetryEndMessage {
  return msg.type === "retry_start" || msg.type === "retry_tick" || msg.type === "retry_end";
}
