import type { z } from "zod";
import type { HookContext } from "../hooks/types";
import type { ThinkingEffort } from "../../../../_shared/types";

export type PermissionMode = "allow" | "ask" | "deny";

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
  /** When set, the tool signals the turn should stop after this result */
  _stopTurn?: boolean;
}

export interface SubagentConfigRequest {
  requestId: string;
  toolCallId?: string;
  reason: string;
  suggestedProvider?: string;
  suggestedModel?: string;
}

export interface SubagentConfigReply {
  action: "once" | "global" | "cancel";
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinkingEffort?: ThinkingEffort;
  maxSteps?: number;
}

export interface AgentChangeRequest {
  requestId: string;
  toolCallId?: string;
  suggestedAgent: string;
  reason: string;
  agents: Array<{ name: string; isCurrent: boolean }>;
  suggestedAction?: "end_turn" | "continue";
}

export interface AgentChangeReply {
  action: "switch" | "switch_continue" | "continue" | "stop";
  agentName?: string;
  continueMessage?: {
    content: string;
    agentName: string;
  };
}

/** Base context used by all tools. Contains only the common fields. */
export interface BaseToolContext {
  sessionId: string;
  turnId: number;
  workspaceRoot: string;
  /** Momiji data dir (data/{mode}) for layered perms */
  dataDir: string;
  abortSignal: AbortSignal;
  messageId?: string;
  callId: string;
  /** Name of the tool currently executing (set by the registry). Drives per-tool external-directory permission keys. */
  toolName?: string;
  askPermission: (toolName: string, args: unknown) => Promise<boolean>;
  /** When set, tool.* hooks fire after the permission gate */
  hookCtx?: HookContext;
}

/** Extended context used only by the task tool — adds subagent/slot/agent callbacks. */
export interface ExtendedToolContext extends BaseToolContext {
  /**
   * Turn-level permission bridge for nested subagent tool calls.
   * Uses a fresh callId (child tool), not this context's callId.
   */
  bridgePermission?: (
    toolName: string,
    args: unknown,
    callId: string
  ) => Promise<boolean>;
  /** Forward nested subagent tool lifecycle to the parent UI (WS). */
  bridgeToolCall?: (e: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }) => void;
  bridgeToolResult?: (e: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
  }) => void;
  bridgeToolUpdate?: (e: { toolCallId: string; status: string }) => void;
  /**
   * Prompt the user to pick provider/model for this subagent task.
   */
  requestSubagentConfig?: (
    req: SubagentConfigRequest
  ) => Promise<SubagentConfigReply>;
  /**
   * When LLM slots are busy and policy is ask, prompt wait/fail/cancel.
   */
  requestSlotBusyDecision?: (req: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    baseUrl: string;
    defaultPollIntervalSec: number;
    defaultWaitTimeoutSec: number;
  }) => Promise<{
    action: "wait" | "fail" | "cancel";
    pollIntervalSec?: number;
    waitTimeoutSec?: number;
  }>;
  /**
   * Prompt user to switch agent. Returns user's decision.
   */
  requestAgentChange?: (
    req: AgentChangeRequest
  ) => Promise<AgentChangeReply>;
  /** Abort the current turn (same as Stop button) */
  abortTurn?: () => void;
  /** Slot wait UI: started polling for free slot */
  onSlotWaitStart?: (info: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    pollIntervalSec: number;
    waitTimeoutSec: number;
  }) => void;
  onSlotWaitStatus?: (info: { requestId: string; message: string }) => void;
  onSlotWaitEnd?: (info: { requestId: string }) => void;
}

export function isStopTurnResult(result: unknown): boolean {
  return typeof result === "object" && result !== null &&
    "_stopTurn" in result &&
    (result as Record<string, unknown>)._stopTurn === true;
}

export interface ToolDef<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  permissionDefault: PermissionMode;
  /** Optional structured description of the tool's output/metadata fields. */
  outputFields?: ToolFieldDef[];
  execute: (args: z.infer<TSchema>, ctx: BaseToolContext) => Promise<ToolResult>;
}

export { type ToolFieldDef } from "./schema";
