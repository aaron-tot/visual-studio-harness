export type SessionKind = "primary" | "subagent";

export type ThinkingEffort = "off" | "low" | "medium" | "high";

export interface SessionMeta {
  id: string;
  title: string;
  providerName: string;
  modelName: string;
  workspaceRoot?: string;
  created: string;
  updated: string;
  archived?: boolean;
  kind?: SessionKind;
  parentId?: string;
  taskLabel?: string;
  agentName?: string;
  thinkingEffort?: ThinkingEffort;
}

export interface SessionConfig {
  agentName: string | null;
  providerName: string;
  modelName: string;
  thinkingEffort: ThinkingEffort;
}

/** Group accent colors for session-list section titles. */
export type GroupColor =
  | "neutral"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "blue"
  | "violet"
  | "pink";

export interface LayoutNode {
  kind: "group" | "session";
  id: string;
  /** Group display name. Ignored for sessions. */
  name?: string;
  /** Group accent color. Ignored for sessions. */
  color?: GroupColor;
  /** Children (only for groups; sessions have no children). */
  children?: LayoutNode[];
}

export interface SessionLayout {
  workspaceRoot: string;
  tree: LayoutNode[];
}

export interface Session {
  meta: SessionMeta;
  messages: import("./message").Message[];
}
