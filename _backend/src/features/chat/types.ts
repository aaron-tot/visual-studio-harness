import type {
  ConfigFile,
  HookSource,
  HookContext,
  Message,
  MessagePartType,
  SessionKind,
  SessionMeta,
  ThinkingEffort,
} from "../../../../_shared/types";
import type { LlmErrorInfo } from "../../llm/errors";
import type {
  ExtendedToolContext,
  SubagentConfigRequest,
  SubagentConfigReply,
  AgentChangeRequest,
  AgentChangeReply,
} from "../../features/tools/types";

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
}

export interface TurnEvents {
  onSessionReady?: (info: { sessionId: string; created: boolean; meta: SessionMeta }) => void;
  onToken?: (token: string, seq: number) => void;
  onReasoning?: (delta: string, seq: number) => void;
  onToolCall?: (e: { toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string; seq?: number }) => void;
  onToolResult?: (e: { toolCallId: string; toolName: string; output: unknown; isError?: boolean; seq?: number }) => void;
  onToolUpdate?: (e: { toolCallId: string; status: string; seq?: number }) => void;
  askPermission?: (toolName: string, args: unknown, callId: string) => Promise<boolean>;
  requestSubagentConfig?: (req: SubagentConfigRequest) => Promise<SubagentConfigReply>;
  requestSlotBusyDecision?: NonNullable<ExtendedToolContext["requestSlotBusyDecision"]>;
  requestAgentChange?: (req: AgentChangeRequest) => Promise<AgentChangeReply>;
  abortTurn?: () => void;
  onSlotWaitStart?: NonNullable<ExtendedToolContext["onSlotWaitStart"]>;
  onSlotWaitStatus?: NonNullable<ExtendedToolContext["onSlotWaitStatus"]>;
  onSlotWaitEnd?: NonNullable<ExtendedToolContext["onSlotWaitEnd"]>;
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
  modelName?: string;
  providerName?: string;
  durationMs?: number;
  turnId?: number;
  success?: boolean;
}

export type OpenStreamPart = {
  type: "text" | "reasoning";
  partId: number;
  content: string;
  seq: number;
};
