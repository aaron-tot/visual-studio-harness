export type ToolCallStatus =
  | "running"
  | "awaiting_permission"
  | "awaiting_config"
  | "awaiting_question"
  | "awaiting_agent_change"
  | "completed"
  | "error";

export type PermissionMode = "allow" | "ask" | "deny";

export interface PermsFile {
  version: number;
  tools: Record<string, PermissionMode>;
}

export type PermissionDecision =
  | "deny"
  | "approve"
  | "approve_session"
  | "deny_session"
  | "approve_workspace"
  | "deny_workspace"
  | "approve_global"
  | "deny_global";

export type PermsLayer = "session" | "workspace" | "global";
