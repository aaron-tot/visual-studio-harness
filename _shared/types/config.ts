import type { ThinkingEffort } from "./session";

export interface ModelConfig {
  displayName: string;
  modelName: string;
  enabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  isLoaded?: boolean;
}

export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ModelConfig[];
  enabled?: boolean;
  test?: boolean;
}

export type SlotBusyPolicy = "wait" | "fail" | "ask";

export interface AgentRuntimeSettings {
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinking?: { effort: ThinkingEffort };
  maxSteps?: number;
  maxConcurrent?: number;
  slotBusyPolicy?: SlotBusyPolicy;
  slotPollIntervalSec?: number;
  slotWaitTimeoutSec?: number;
}

export interface AgentMdConfig {
  mode: "existing" | "inline";
  path?: string;
  content?: string;
  /** Tag-based resolution — scan scope roots for an item whose prompt.json has this tag. */
  tag?: string;
  /** Scope to search for tag-based resolution. If omitted, all scopes are searched (session > project > global). */
  scope?: "global" | "project" | "session";
}

export interface SkillMdConfig {
  mode: "existing" | "custom";
  name?: string;
  path?: string;
  /** Tag-based resolution — scan scope roots for an item whose prompt.json has this tag. */
  tag?: string;
  /** Scope to limit tag search. If omitted, all scopes are searched. */
  scope?: "global" | "project" | "session";
  /** How the skill is attached to the agent. Default: "inject". */
  attachmentMode?: "inject" | "hard" | "soft";
}

export interface AgentSettings {
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinking?: { effort: ThinkingEffort };
  maxSteps?: number;
  color?: string;
  agentMd?: AgentMdConfig;
  skillMds?: SkillMdConfig[];
  /** Controls which skills the agent can access via the skill tool. Default: "all". */
  skillAccess?: "all" | "attached";
  /** Additional system info (volatile tail) configuration. */
  additionalSystemInfo?: AdditionalSystemInfoSettings;
  /** Which dynamic sections are ALSO baked into the static base system prompt (built once per turn). */
  systemPromptSections?: SystemPromptSections;
  /** Per-agent workspace manifest settings (overrides the global default). */
  workspaceManifest?: WorkspaceManifestSettings;
}

export type AdditionalSystemInfoVisibility = "hidden" | "collapsed" | "expanded";

export interface AdditionalSystemInfoSettings {
  /** Which volatile sections are rendered into the trailing block. Empty ⇒ no message emitted. */
  sections: Array<"runtime" | "todoList" | "workspaceManifest">;
  /** UI default. Backend ignores this per the spec (persist is always true). */
  visibility: AdditionalSystemInfoVisibility;
  /** Always true in this design. */
  persist: boolean;
  /** If true, embeds a timestamp so the content ALWAYS changes each step.
   *  Default: false ⇒ only injected when manifest/todo actually change. */
  includeTime?: boolean;
  /** If true, ALWAYS inject the block at the end of every step regardless of
   *  whether the content changed (e.g. a constant todo-list reminder). Separate
   *  from `includeTime` (which changes the content); `always` re-emits whatever
   *  the enabled `sections` render, every step. Warns of growing token usage
   *  (cached, but accumulates a pair per step over time). Default: false. */
  always?: boolean;
}

export const DEFAULT_ADDITIONAL_SYSTEM_INFO: AdditionalSystemInfoSettings = {
  sections: ["runtime", "todoList", "workspaceManifest"],
  visibility: "collapsed",
  persist: true,
  includeTime: false,
  always: false,
};

/**
 * Which dynamic sections are ALSO baked into the static base system prompt.
 * Per-agent only. The base is rebuilt once per turn and is byte-identical within
 * the turn, so content included here is NOT refreshed per step — see the settings
 * note. Each section renders the SAME canonical format as in the trailing
 * additional_system_info block.
 */
export interface SystemPromptSections {
  /** Runtime facts (workspace, mode, data_dir, os, session_id, datetime, elapsed). */
  runtime: boolean;
  /** TODO list snapshot (static per turn). */
  todoList: boolean;
  /** Workspace manifest snapshot (static per turn). */
  workspaceManifest: boolean;
}

export const DEFAULT_SYSTEM_PROMPT_SECTIONS: SystemPromptSections = {
  runtime: true,
  todoList: false,
  workspaceManifest: false,
};

export interface SubagentToolSettings {
  maxConcurrent?: number;
  slotBusyPolicy?: SlotBusyPolicy;
  slotPollIntervalSec?: number;
  slotWaitTimeoutSec?: number;
}

export interface BashToolSettings {
  timeoutMinMs?: number;
  timeoutMaxMs?: number;
  timeoutDefaultMs?: number;
}

export interface WebfetchToolSettings {
  timeoutMinSec?: number;
  timeoutMaxSec?: number;
  timeoutDefaultSec?: number;
}

export interface ToolSettings {
  bash?: BashToolSettings;
  webFetch?: WebfetchToolSettings;
}

export interface SystemPromptJoiners {
  start: string;
  preGlobal: string;
  postGlobal: string;
  preAgent: string;
  postAgent: string;
  preSkills: string;
  postSkills: string;
  preProject: string;
  postProject: string;
  preRuntime: string;
  postRuntime: string;
  preTodoList: string;
  postTodoList: string;
  preWorkspaceManifest: string;
  postWorkspaceManifest: string;
  preExtras: string;
  postExtras: string;
  end: string;
}

export interface TestModelConfig {
  tokensPerSecond?: number;
}

export interface SnippetConfig {
  name: string;
  content: string;
}

export interface McpServerConfig {
  name: string;
  enabled?: boolean;
  transport: "stdio" | "http" | "tcp";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface WorkspaceManifestSettings {
  enabled: boolean;
  maxDepth?: number;
  includeFiles?: boolean;
  excludeDirs?: string[];
  excludeExtensions?: string[];
  includeGitignore?: boolean;
  agents?: string[];
  prefix?: string;
  postfix?: string;
}

export type SearchProviderType = "exa" | "parallel" | "brave" | "serper" | "custom";

export interface SearchProviderConfig {
  id: string;
  type: SearchProviderType;
  name: string;
  enabled: boolean;
  priority: number;
  apiKey?: string;
  rateLimit?: { rpm?: number; rpd?: number };
  tags?: string[];
  customMcpUrl?: string;
}

export interface KnowledgeBaseConfig {
  enabled: boolean;
  sourcesPath: string;
  dbPath: string;
  embedding: {
    providerId: string;
    model: string;
    batchSize: number;
  };
  search: {
    vectorWeight: number;
    keywordWeight: number;
    metadataWeight: number;
    topK: number;
    reranking: boolean;
  };
}

export interface ConfigFile {
  providers: ProviderConfig[];
  searchProviders?: SearchProviderConfig[];
  knowledge?: KnowledgeBaseConfig;
  agents?: Record<string, AgentSettings>;
  subagent?: SubagentToolSettings;
  toolSettings?: ToolSettings;
  systemPromptJoiners?: SystemPromptJoiners;
  additionalSystemInfo?: AdditionalSystemInfoSettings;
  defaultAgent?: string;
  defaultProvider?: string;
  defaultModel?: string;
  /** Config-level default system prompt base. New agents inherit this. Overridable per-agent. */
  systemPromptBase?: AgentMdConfig;
  testModels?: Record<string, TestModelConfig>;
  mcpServers?: McpServerConfig[];
  workspaceManifest?: WorkspaceManifestSettings;
  workspaceGraph?: boolean;
  autoContinueOnToolEnd?: boolean;
  autoContinueOnToolEndMaxAttempts?: number;
  autoContinueOnToolEndWindowValue?: number;
  autoContinueOnToolEndWindowUnit?: "seconds" | "minutes" | "hours";
  autoContinueOnToolEndPrompt?: string;
  autoContinueOnThinkingEnd?: boolean;
  autoContinueOnThinkingEndMaxAttempts?: number;
  autoContinueOnThinkingEndWindowValue?: number;
  autoContinueOnThinkingEndWindowUnit?: "seconds" | "minutes" | "hours";
  autoContinueOnThinkingEndPrompt?: string;
  headless?: boolean;
  keybindings?: Record<string, string>;
  snippets?: SnippetConfig[];
  messagePanelFullWidth?: boolean;
  messagePanelPinnedDefault?: boolean;
  showSessionName?: boolean;
  /** Include failed/aborted turns in conversation history for context (default: true) */
  includeFailedTurnsInHistory?: boolean;
  /** Include tool calls and results from previous turns in SDK messages (default: true) */
  includeToolCallsInHistory?: boolean;
  /** Include reasoning/thinking from previous turns in SDK messages (default: false) */
  includeReasoningInHistory?: boolean;
  /** Include patches/diffs from previous turns in SDK messages (default: false) */
  includePatchesInHistory?: boolean;
  /** Include other part types (snapshot, error, question, etc.) from previous turns in SDK messages (default: false) */
  includeOtherPartsInHistory?: boolean;
  /** Maximum number of historical turns to include (context window) */
  contextMaxTurns?: number;
  /** Include the previous summary in the summarizer input (default: true) */
  summarizeIncludePriorSummary?: boolean;
  /** Error message substring (case-insensitive) that triggers a streaming retry. */
  streamRetryErrorName?: string;
  /** Maximum number of retries for the streamRetryErrorName error. */
  streamRetryMaxAttempts?: number;

  /** Permission request timeout configuration */
  permissionRequestTimeoutEnabled?: boolean;
  permissionRequestTimeoutMs?: number;
}
