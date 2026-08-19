import type {
  ConfigFile,
  Message,
  MessagePartType,
  RetryEntry,
  SessionKind,
  SessionMeta,
  ThinkingEffort,
} from "../../../../_shared/types";
import type { HookSource, HookContext } from "../hooks/types";
import type { LlmErrorInfo } from "../../llm/errors";
import type {
  ExtendedToolContext,
  SubagentConfigRequest,
  SubagentConfigReply,
  AgentChangeRequest,
  AgentChangeReply,
} from "../../features/tools/types";
import type { StepToolBatchBeforePayload, StepToolBatchAfterPayload } from "../../../../_shared/types/step-batch";

export interface TurnCreateMeta {
  kind?: SessionKind;
  parentId?: string;
  taskLabel?: string;
  title?: string;
}

export interface TurnInput {
  content: string;
  sessionId?: string | null;
  workspaceRoot?: string;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  thinkingEffort?: ThinkingEffort;
  noSystemPrompt?: boolean;
  excludeTools?: string[];
  createMeta?: TurnCreateMeta;
  contextFirstTurnNumber?: number | null;
  /** Parent conversation id for subagent turns (forwarded as x-parent-session-id). */
  parentSessionId?: string;
}

export interface TurnEvents {
  onSessionReady?: (info: { sessionId: string; created: boolean; meta: SessionMeta; turnId?: number }) => void;
  onToken?: (token: string, seq: number, tps?: number) => void;
  onReasoning?: (delta: string, seq: number, tps?: number) => void;
  onToolCall?: (e: { toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string; seq?: number; stepIndex?: number }) => void;
  onToolResult?: (e: { toolCallId: string; toolName: string; output: unknown; isError?: boolean; seq?: number }) => void;
  onToolUpdate?: (e: { toolCallId: string; status: string; seq?: number; taskId?: string }) => void;
  onToolBatchStart?: (e: StepToolBatchBeforePayload) => void | Promise<void>;
  onToolBatchEnd?: (e: StepToolBatchAfterPayload) => void | Promise<void>;
  /** Called after a step is finalized & persisted (used to refresh live usage/stats). */
  onStepEnd?: (e: { stepIndex?: number; contextTokens?: { used: number; max: number; pending?: boolean } }) => void | Promise<void>;
  /** Called when a retryable failure is recorded (before the retry wait). seq is turn-global. */
  onRetryError?: (e: { entry: RetryEntry; seq: number }) => void;
  /** Called when the reasoning/thinking phase ends (text, tool, or step finish after reasoning). */
  onThinkingEnd?: () => void | Promise<void>;
  askPermission?: (toolName: string, args: unknown, callId: string) => Promise<boolean>;
  requestSubagentConfig?: (req: SubagentConfigRequest) => Promise<SubagentConfigReply>;
  requestSlotBusyDecision?: NonNullable<ExtendedToolContext["requestSlotBusyDecision"]>;
  requestAgentChange?: (req: AgentChangeRequest) => Promise<AgentChangeReply>;
  abortTurn?: () => void;
  onSlotWaitStart?: NonNullable<ExtendedToolContext["onSlotWaitStart"]>;
  onSlotWaitStatus?: NonNullable<ExtendedToolContext["onSlotWaitStatus"]>;
  onSlotWaitEnd?: NonNullable<ExtendedToolContext["onSlotWaitEnd"]>;
  /** Called when the turn starts streaming; used to broadcast session_stream_start. */
  announceStreamStart?: () => void;
  signal?: AbortSignal;
  source?: HookSource;
}

export interface TurnResult {
  sessionId: string;
  created: boolean;
  meta: SessionMeta;
  workspaceRoot: string;
  userMessage: Message;
  assistantMessage: Message | null;
  error?: string;
  rawError?: string;
  errorIsCustom?: boolean;
  agentName?: string;
  modelName?: string;
  providerName?: string;
  durationMs?: number;
  turnId?: number;
  success?: boolean;
  /** Retry log for the turn's failures (forwarded in the WS error event). */
  retries?: RetryEntry[];
}

export type OpenStreamPart = {
  type: "text" | "reasoning";
  partId: number;
  content: string;
  seq: number;
};
