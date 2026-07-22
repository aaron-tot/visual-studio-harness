import type { Message, MessagePartType, PermissionDecision, SessionMeta, SessionConfig, ThinkingEffort, ToolCallStatus, TurnsFile } from "../../../_shared/types";

export interface ChatState {
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  streamingParts: MessagePartType[];
  lastSeq: number;
  _partSeq: number;
  _textSeq: number;
  _reasonIdx: number;
  _pendingAgentName?: string;
  _pendingDropdownAgent?: string;
  _pendingContinueMessage?: { content: string; agentName: string } | null;
  sessionId: string | null;
  streamingTurnId: number | null;
  sessionMeta: SessionMeta | null;
  workspaceRoot: string;
  turns: TurnsFile;
  inspectedTurnId: number | null;
  setWorkspaceRoot: (path: string) => void;
  updateSessionMeta: (patch: Partial<SessionMeta>) => void;
  loadSession: (id: string) => Promise<void>;
  loadTurns: (sessionId: string) => Promise<void>;
  setInspectedTurnId: (turnId: number | null) => void;
  stagedChatInput: string;
  stageChatInput: (content: string) => void;
  sendMessage: (content: string, config: SessionConfig) => void;
  clearMessages: () => void;
  stopStreaming: () => void;
  appendToken: (token: string, seq?: number) => void;
  appendReasoning: (delta: string, seq?: number) => void;
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
  }) => void;
  onToolStart: (e: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    parentToolCallId?: string;
    seq?: number;
  }) => void;
  onToolUpdate: (e: { toolCallId: string; status: ToolCallStatus; partial?: string; seq?: number }) => void;
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
}

export type BufferedDelta =
  | { kind: "token"; sessionId: string; content: string; seq?: number }
  | { kind: "reasoning"; sessionId: string; content: string; seq?: number }
  | {
      kind: "tool_start";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      parentToolCallId?: string;
      seq?: number;
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
    };
