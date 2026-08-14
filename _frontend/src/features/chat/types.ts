import type { Message, MessagePartType, PermissionDecision, RetryEntry, SessionMeta, SessionConfig, ThinkingEffort, ToolCallStatus, TurnsFile } from "../../../_shared/types";

export interface RetryCountdownState {
  attempt: number;
  maxAttempts: number;
  totalDelayMs: number;
  remainingMs: number;
  errorLabel: string;
}

export interface ChatState {
  messages: Message[];
  streaming: boolean;
  stopping: boolean;
  streamingContent: string;
  streamingParts: MessagePartType[];
  /** Live output TPS estimate (chars/4, VSH-calculated) — under-bubble badge while streaming. */
  streamingOutputTps: number | null;
  lastSeq: number;
  _partSeq: number;
  _textSeq: number;
  _reasonIdx: number;
  _pendingAgentName?: string;
  _pendingModelName?: string;
  _pendingProviderName?: string;
  _pendingDropdownAgent?: string;
  /** Bumped on New Chat / clear so the composer resets to settings defaults. */
  composerResetEpoch: number;
  _pendingContinueMessage?: { content: string; agentName: string } | null;
  sessionId: string | null;
  streamingTurnId: number | null;
  sessionMeta: SessionMeta | null;
  workspaceRoot: string;
  turns: TurnsFile;
  inspectedTurnId: number | null;
  streamingStartTime: number | null;
  retryCountdown: RetryCountdownState | null;
  setWorkspaceRoot: (path: string) => void;
  updateSessionMeta: (patch: Partial<SessionMeta>) => void;
  loadSession: (id: string) => Promise<void>;
  loadTurns: (sessionId: string) => Promise<void>;
  setInspectedTurnId: (turnId: number | null) => void;
  stagedChatInput: string;
  stageChatInput: (content: string | ((prev: string) => string)) => void;
  sendMessage: (content: string, config: SessionConfig) => void;
  contextFirstTurnNumber: number | null;
  setContextFirstTurnNumber: (tn: number | null) => void;
  contextConfigVersion: number;
  bumpContextConfigVersion: () => void;
  clearMessages: () => void;
  stopStreaming: () => void;
  appendToken: (token: string, seq?: number, tps?: number) => void;
  appendReasoning: (delta: string, seq?: number, tps?: number) => void;
  /** Clears the live TPS badge from the active thinking part (thinking phase ended). */
  endThinking: () => void;
  /** Clears the live output TPS badge (tool call started or stream paused). */
  clearOutputTps: () => void;
  doneStreaming: (modelName?: string, providerName?: string, durationMs?: number, turnId?: number, agentName?: string) => void;
  failStreaming: (error: string, meta?: {
    modelName?: string;
    providerName?: string;
    durationMs?: number;
    turnId?: number;
    agentName?: string;
    rawError?: string;
    errorIsCustom?: boolean;
    category?: "config" | "auth" | "network" | "streaming" | "server" | "abort" | "unknown";
    status?: string;
    /** Retry log from the backend (authoritative on final failure). */
    retries?: RetryEntry[];
    /** When the final error occurred (ISO). */
    errorTime?: string;
  }) => void;
  /** Live retryable-error event: upserts the error part in streamingParts + starts the countdown bar. */
  onRetryError: (payload: { entry: RetryEntry; seq: number }) => void;
  onToolStart: (e: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    parentToolCallId?: string;
    seq?: number;
    stepIndex?: number;
  }) => void;
  onToolUpdate: (e: { toolCallId: string; status: ToolCallStatus; partial?: string; seq?: number; taskId?: string }) => void;
  onToolEnd: (e: {
    toolCallId: string;
    status: ToolCallStatus;
    result?: unknown;
    error?: string;
    seq?: number;
    turnId?: number;
  }) => void;
  respondPermission: (toolCallId: string, decision: PermissionDecision, sessionId?: string | null, toolName?: string) => void;
  respondSubagentConfig: (payload: {
    requestId: string;
    sessionId: string;
    action: "once" | "global" | "cancel";
    providerName?: string;
    modelName?: string;
    temperature?: number;
    thinkingEffort?: "off" | "low" | "medium" | "high";
    maxSteps?: number;
  }) => void;
  respondSlotBusy: (payload: {
    requestId: string;
    sessionId: string;
    action: "wait" | "fail" | "cancel";
    pollIntervalSec?: number;
    waitTimeoutSec?: number;
  }) => void;
  respondAgentChange: (payload: {
    requestId: string;
    sessionId: string;
    action: "switch" | "continue" | "stop" | "switch_continue";
    agentName?: string;
    continueMessage?: { content: string; agentName: string };
  }) => void;
  subagentConfigPrompt: {
    requestId: string;
    sessionId: string;
    toolCallId?: string;
    reason: string;
    suggestedProvider?: string;
    suggestedModel?: string;
  } | null;
  setSubagentConfigPrompt: (prompt: ChatState["subagentConfigPrompt"]) => void;
  slotBusyPrompt: {
    requestId: string;
    sessionId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    baseUrl: string;
    defaultPollIntervalSec: number;
    defaultWaitTimeoutSec: number;
  } | null;
  setSlotBusyPrompt: (prompt: ChatState["slotBusyPrompt"]) => void;
  agentChangePrompt: {
    requestId: string;
    sessionId: string;
    toolCallId?: string;
    suggestedAgent: string;
    reason: string;
    agents: Array<{ name: string; isCurrent: boolean }>;
    suggestedAction?: "end_turn" | "continue";
  } | null;
  setAgentChangePrompt: (prompt: ChatState["agentChangePrompt"]) => void;
  slotWaitState: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    pollIntervalSec: number;
    waitTimeoutSec: number;
    statusMessage?: string;
  } | null;
  abortSlotWait: (requestId: string) => void;
  setStreamingStartTime: (time: number | null) => void;
  setRetryCountdown: (state: RetryCountdownState) => void;
  updateRetryCountdown: (remainingMs: number) => void;
  clearRetryCountdown: () => void;
  clearNewChatDraft: () => void;
  startNewChat: () => void;
  setStreamingStartTime: (time: number | null) => void;
}

export type BufferedDelta =
  | { kind: "token"; sessionId: string; content: string; seq?: number; tps?: number }
  | { kind: "reasoning"; sessionId: string; content: string; seq?: number; tps?: number }
  | { kind: "thinking_end"; sessionId: string }
  | {
      kind: "tool_start";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      parentToolCallId?: string;
      seq?: number;
      stepIndex?: number;
    }
  | {
      kind: "tool_end";
      sessionId: string;
      toolCallId: string;
      status: ToolCallStatus;
      result?: unknown;
      error?: string;
      seq?: number;
      turnId?: number;
    }
  | {
      kind: "tool_update";
      sessionId: string;
      toolCallId: string;
      status: ToolCallStatus;
      partial?: string;
      seq?: number;
      taskId?: string;
    }
  | {
      kind: "done";
      sessionId: string;
      modelName?: string;
      providerName?: string;
      durationMs?: number;
      turnId?: number;
      agentName?: string;
    }
  | {
      kind: "error";
      sessionId: string;
      error: string;
      rawError?: string;
      errorIsCustom?: boolean;
      category?: "config" | "auth" | "network" | "streaming" | "server" | "abort" | "unknown";
      modelName?: string;
      providerName?: string;
      durationMs?: number;
      turnId?: number;
      agentName?: string;
      status?: string;
      retries?: RetryEntry[];
      errorTime?: string;
    }
  | { kind: "retry_error"; sessionId: string; entry: RetryEntry; seq: number };
