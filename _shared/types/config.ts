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
}

export interface SkillMdConfig {
  mode: "existing" | "custom";
  name?: string;
  path?: string;
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
}

export interface SubagentToolSettings {
  maxConcurrent?: number;
  slotBusyPolicy?: SlotBusyPolicy;
  slotPollIntervalSec?: number;
  slotWaitTimeoutSec?: number;
}

export interface SystemPromptJoiners {
  start: string;
  afterGlobal: string;
  afterAgentMd: string;
  afterSkillMds: string;
  afterProject: string;
  afterRuntime: string;
  afterTodoList: string;
  afterExtras: string;
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

export interface ConfigFile {
  providers: ProviderConfig[];
  agents?: Record<string, AgentSettings>;
  subagent?: SubagentToolSettings;
  systemPromptJoiners?: SystemPromptJoiners;
  defaultAgent?: string;
  defaultProvider?: string;
  defaultModel?: string;
  testModels?: Record<string, TestModelConfig>;
  mcpServers?: McpServerConfig[];
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
  /** Error message substring (case-insensitive) that triggers a streaming retry. */
  streamRetryErrorName?: string;
  /** Maximum number of retries for the streamRetryErrorName error. */
  streamRetryMaxAttempts?: number;
}
