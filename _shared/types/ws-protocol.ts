import type { PermissionDecision, ToolCallStatus } from "./tools";
import type { SessionMeta, ThinkingEffort } from "./session";
import type { ConfigFile } from "./config";

export type WsClientMessage =
  | { type: "chat"; sessionId: string; content: string; workspaceRoot?: string; agentName?: string | null }
  | { type: "permission_response"; sessionId: string; toolCallId: string; decision?: PermissionDecision; approved?: boolean; reason?: string; toolName?: string }
  | { type: "subagent_config_response"; sessionId: string; requestId: string; action: "once" | "global" | "cancel"; providerName?: string; modelName?: string; temperature?: number; thinkingEffort?: ThinkingEffort; maxSteps?: number }
  | { type: "slot_busy_response"; sessionId: string; requestId: string; action: "wait" | "fail" | "cancel"; pollIntervalSec?: number; waitTimeoutSec?: number }
  | { type: "slot_wait_abort"; sessionId: string; requestId: string }
  | { type: "agent_change_response"; sessionId: string; requestId: string; action: "switch" | "switch_continue" | "continue" | "stop"; agentName?: string; continueMessage?: { content: string; agentName: string } }
  | { type: "session_update"; sessionId: string; providerName?: string; modelName?: string; agentName?: string | null; thinkingEffort?: ThinkingEffort }
  | { type: "cancel"; sessionId: string };

export type WsServerMessage =
  | { type: "token"; sessionId: string; content: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; sessionId: string; error: string; rawError?: string; errorIsCustom?: boolean }
  | { type: "config_updated"; config: ConfigFile }
  | { type: "session_created"; session: SessionMeta }
  | { type: "session_updated"; session: SessionMeta }
  | { type: "tool_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string }
  | { type: "tool_update"; sessionId: string; toolCallId: string; status: ToolCallStatus; partial?: string; parentToolCallId?: string }
  | { type: "tool_end"; sessionId: string; toolCallId: string; status: ToolCallStatus; result?: unknown; error?: string; parentToolCallId?: string }
  | { type: "permission_request"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "subagent_config_request"; sessionId: string; requestId: string; toolCallId?: string; reason: string; suggestedProvider?: string; suggestedModel?: string }
  | { type: "slot_busy_request"; sessionId: string; requestId: string; toolCallId?: string; detail: string; free: number; total: number; modelAlias?: string; baseUrl: string; defaultPollIntervalSec: number; defaultWaitTimeoutSec: number }
  | { type: "slot_wait_started"; sessionId: string; requestId: string; toolCallId?: string; detail: string; free: number; total: number; modelAlias?: string; pollIntervalSec: number; waitTimeoutSec: number }
  | { type: "slot_wait_status"; sessionId: string; requestId: string; message: string }
  | { type: "slot_wait_ended"; sessionId: string; requestId: string }
  | { type: "agent_change_request"; sessionId: string; requestId: string; toolCallId?: string; suggestedAgent: string; reason: string; agents: Array<{ name: string; isCurrent: boolean }> }
  | { type: "session_stream_start"; sessionId: string }
  | { type: "session_stream_end"; sessionId: string; success?: boolean };
