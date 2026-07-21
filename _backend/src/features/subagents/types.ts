import type { ExtendedToolContext } from "../tools/types";

export interface SubagentSpawnArgs {
  /** Agent config key from config.agents to use for this subagent. */
  agentKey: string;
  description: string;
  prompt: string;
  /** Resume existing child session (task_id). */
  taskId?: string;
}

export interface SubagentSpawnResult {
  title: string;
  output: string;
  metadata: {
    task_id: string;
    status: "completed" | "error" | "cancelled";
    parentSessionId: string;
    providerName?: string;
    modelName?: string;
    childTurnNumber?: number;
  };
  isError?: boolean;
}

export interface SubagentSpawnContext {
  parent: ExtendedToolContext;
  parentSessionId: string;
  workspaceRoot: string;
  dataDir: string;
  abortSignal: AbortSignal;
  /**
   * Bridge child tool permission prompts to the parent turn UI.
   * callId is the child tool call id.
   */
  bridgePermission?: (
    toolName: string,
    args: unknown,
    callId: string
  ) => Promise<boolean>;
  /** Forward child tool cards into the parent session UI. */
  onToolCall?: (e: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }) => void;
  onToolResult?: (e: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
  }) => void;
  onToolUpdate?: (e: { toolCallId: string; status: string }) => void;
}
