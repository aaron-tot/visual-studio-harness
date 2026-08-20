import type { ThinkingEffort } from "./session";

export interface ModelConfig {
  displayName: string;
  modelName: string;
  enabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  isLoaded?: boolean;
  /** OpenRouter-style fixed provider routing. order = providers to try, in preference order. */
  providerOrder?: string[];
  /** When false, do not fall back beyond providerOrder — keeps prompt cache stable. Default true. */
  allowProviderFallbacks?: boolean;
}

export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ModelConfig[];
  enabled?: boolean;
  test?: boolean;
  /** Explicit models.dev provider id override (e.g., "opencode", "opencode-go", "openrouter", "ollama"). If omitted, resolved from displayName/baseUrl. */
  pricingProviderId?: string;
}

export type SlotBusyPolicy = "wait" | "fail" | "ask";

/** How tool calls issued in the same step are executed: one at a time (sequential) or concurrently. */
export type ToolExecutionMode = "sequential" | "concurrent";

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
  /** How the skill is attached to the agent. REQUIRED — no default. */
  attachmentMode: "inject" | "hard" | "soft";
}

export interface AgentSettings {
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinking?: { effort: ThinkingEffort };
  maxSteps?: number;
  color?: string;
  agentMd?: AgentMdConfig;
  /** Per-agent global system prompt base override (falls back to config.systemPromptBase). */
  systemPromptBase?: AgentMdConfig;
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
  /** UI default. */
  visibility: AdditionalSystemInfoVisibility;
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
  description?: string;
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

/** Persisted state of the last update check (prod-only feature). */
export interface UpdateState {
  /** ISO timestamp of the last *successful* check. Failures leave this unchanged so it retries. */
  lastChecked: string | null;
  available: boolean;
  /** Git SHA the running binary was built from. */
  buildCommit: string;
  /** Latest main-branch SHA observed at last successful check. */
  latestCommit: string | null;
  /** Number of commits this build is behind main (0 when up to date). */
  commitsBehind: number;
  lastError: string | null;
}

/** Where the update indicator looks for new commits. Overridable via config.updatesRepo. */
export const DEFAULT_UPDATE_REPO: { owner: string; name: string } = {
  owner: "aaron-tot",
  name: "visual-studio-harness",
};

/** Phone/tablet UI overrides (applies only below lg breakpoint). */
export interface PhoneUiConfig {
  /** Master enable toggle. */
  enabled?: boolean;
  /** Base font scale multiplier for chat messages (default 1.3). */
  messageFontScale?: number;
  /** Base font scale multiplier for input selectors/dropdowns (default 1.2). */
  uiFontScale?: number;
  /** Input textarea min-height multiplier (default 1.5). */
  inputHeightScale?: number;
  /** Global touch target scale for interactive elements (default 1.2). */
  touchTargetScale?: number;
}

export const DEFAULT_PHONE_UI: PhoneUiConfig = {
  enabled: true,
  messageFontScale: 1.3,
  uiFontScale: 1.2,
  inputHeightScale: 1.5,
  touchTargetScale: 1.2,
};

export interface ConfigFile {
  providers: ProviderConfig[];
  /** Phone/tablet UI overrides. Only applies below lg (1024px). */
  phoneUi?: PhoneUiConfig;
  /** @deprecated Search providers now live in `tools/builtin/searchOnline/searchOnline.json` (`ToolConfig.searchProviders`). Kept so existing configs still load. */
  searchProviders?: SearchProviderConfig[];
  /** GitHub repo the update indicator checks for new commits. Defaults to DEFAULT_UPDATE_REPO. */
  updatesRepo?: { owner: string; name: string };
  knowledge?: KnowledgeBaseConfig;
  agents?: Record<string, AgentSettings>;
  /** @deprecated Subagent settings now live in `tools/builtin/task/task.json` (`ToolConfig.subagent`). Kept so existing configs still load. */
  subagent?: SubagentToolSettings;
  /** @deprecated Per-tool timeout settings now live in each tool's own `<name>.json` (`ToolConfig.timeouts`). Kept so existing configs still load. */
  toolSettings?: ToolSettings;
  systemPromptJoiners?: SystemPromptJoiners;
  additionalSystemInfo?: AdditionalSystemInfoSettings;
  defaultAgent?: string;
  defaultProvider?: string;
  defaultModel?: string;
  /** Execution mode for tool calls within a step. Default: "sequential" (one at a time). */
  toolExecutionMode?: ToolExecutionMode;
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
  /** Include the previous summary in the summarizer input (default: true) */
  summarizeIncludePriorSummary?: boolean;
  /** Error message substring (case-insensitive) that triggers a streaming retry. */
  streamRetryErrorName?: string;
  /** Maximum number of retries for the streamRetryErrorName error. */
  streamRetryMaxAttempts?: number;
  /** Enable automatic retry on provider errors (5xx, timeout, network, etc.) */
  streamRetryEnabled?: boolean;
  /** Time window for retry rate limiting */
  streamRetryWindowValue?: number;
  streamRetryWindowUnit?: "seconds" | "minutes" | "hours";
  /** Base delay in ms before first retry */
  streamRetryBaseDelayMs?: number;
  /** Additional delay per retry (ms). 0 = no progressive increase. With 3000: 2s, 5s, 8s, 11s... */
  streamRetryProgressiveDelayMs?: number;

  /** Permission request timeout configuration */
  permissionRequestTimeoutEnabled?: boolean;
  permissionRequestTimeoutMs?: number;

  /** Pricing configuration (models.dev catalog) */
  pricing?: PricingConfig;
}

/** Per-provider override for models.dev provider id (e.g., "opencode" for OpenCode Zen). */
export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ModelConfig[];
  enabled?: boolean;
  test?: boolean;
  /** Explicit models.dev provider id override (e.g., "opencode", "opencode-go", "openrouter", "ollama"). If omitted, resolved from displayName/baseUrl. */
  pricingProviderId?: string;
}

/** Pricing configuration for models.dev catalog integration. */
export interface PricingConfig {
  /**
   * Master switch: when true, pricing is checked at every turn start AND every
   * step start. Checks are instant in-memory lookups; the models.dev catalog is
   * only re-fetched when the cached price is older than `cacheTtlMinutes`.
   */
  enabled?: boolean;
  /**
   * Cache TTL in minutes (default: 60). Acts as a network throttle: the catalog
   * is re-downloaded at most once per TTL window regardless of how many
   * turns/steps run. Failures use a short negative TTL (~5 min) instead.
   */
  cacheTtlMinutes?: number;
  /** Custom models.dev catalog URL (default: https://models.dev/api.json). */
  sourceUrl?: string;
}

/** Normalized pricing snapshot from models.dev catalog. */
export interface PricingSnapshot {
  /** models.dev provider id (e.g., "opencode", "openrouter", "ollama"). */
  providerId: string;
  /** Human-readable provider name from config. */
  providerDisplayName: string;
  /** Model identifier (as used in provider config). */
  modelId: string;
  /** Whether the model was found in the catalog. */
  found: boolean;
  /** Source URL of the catalog. */
  sourceUrl: string;
  /** ISO timestamp when the snapshot was fetched. */
  fetchedAt: string;
  /** Token rates per 1M tokens (USD). */
  rates: {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM: number;
    cacheWritePerM: number;
  };
  /** Optional context-size tiered pricing. */
  tiers?: Array<{
    size: number;
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  }>;
  /** Optional >200k context override pricing. */
  contextOver200K?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Model context/output limits from catalog. */
  limitContext?: number;
  /** Error message if fetch/normalize failed. */
  error?: string;
}

/** Token counts used for cost computation (matches step/turn token columns). */
export interface PricingTokenInput {
  inputTokens?: number;
  noCacheInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

/**
 * Compute cost in USD from token counts and a pricing snapshot.
 * Returns null when snapshot.found is false or rates are unavailable.
 * Formula mirrors opencode's Session.getUsage:
 * - noCacheInput (input - cacheRead - cacheWrite) × inputPerM
 * - (output - reasoning) × outputPerM
 * - reasoning × outputPerM (charged at output rate)
 * - cacheRead × cacheReadPerM
 * - cacheWrite × cacheWritePerM
 * Tier selection: highest context tier ≤ inputTokens, else contextOver200K if > 200k, else base rates.
 */
export function computeCostUsd(
  tokens: PricingTokenInput,
  snapshot: PricingSnapshot
): number | null {
  if (!snapshot.found || !snapshot.rates) return null;

  const inputTokens = tokens.inputTokens ?? 0;
  const noCacheInputTokens =
    tokens.noCacheInputTokens ??
    Math.max(0, inputTokens - (tokens.cacheReadTokens ?? 0) - (tokens.cacheWriteTokens ?? 0));
  const cacheReadTokens = tokens.cacheReadTokens ?? 0;
  const cacheWriteTokens = tokens.cacheWriteTokens ?? 0;
  const outputTokens = tokens.outputTokens ?? 0;
  const reasoningTokens = tokens.reasoningTokens ?? 0;
  const normalOutputTokens = Math.max(0, outputTokens - reasoningTokens);

  // Select rate tier based on input token count
  let rates = snapshot.rates;
  if (snapshot.tiers && snapshot.tiers.length > 0) {
    // Pick highest tier where context size ≤ inputTokens
    const tier = [...snapshot.tiers]
      .sort((a, b) => b.size - a.size)
      .find((t) => inputTokens > t.size);
    if (tier) {
      rates = {
        inputPerM: tier.input,
        outputPerM: tier.output,
        cacheReadPerM: tier.cacheRead ?? snapshot.rates.cacheReadPerM,
        cacheWritePerM: tier.cacheWrite ?? snapshot.rates.cacheWritePerM,
      };
    }
  } else if (snapshot.contextOver200K && inputTokens > 200_000) {
    rates = {
      inputPerM: snapshot.contextOver200K.input,
      outputPerM: snapshot.contextOver200K.output,
      cacheReadPerM: snapshot.contextOver200K.cacheRead ?? snapshot.rates.cacheReadPerM,
      cacheWritePerM: snapshot.contextOver200K.cacheWrite ?? snapshot.rates.cacheWritePerM,
    };
  }

  const cost =
    (noCacheInputTokens / 1_000_000) * rates.inputPerM +
    (normalOutputTokens / 1_000_000) * rates.outputPerM +
    (reasoningTokens / 1_000_000) * rates.outputPerM +
    (cacheReadTokens / 1_000_000) * rates.cacheReadPerM +
    (cacheWriteTokens / 1_000_000) * rates.cacheWritePerM;

  return cost;
}

/**
 * Unified tool config — the `<name>.json` inside each tool folder
 * under `data/tools/{builtin,custom}/<name>/`. Shared by builtin and
 * custom tools (custom tools are `ToolConfig` with an entry file instead
 * of the legacy `CustomTool.code` field).
 */
export interface ToolConfig {
  /** Unique tool name (alphanumeric + hyphens, used as folder name). */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Entry file inside the tool folder (e.g. "index.ts"). */
  entry: string;
  /** JSON Schema object describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** When false, the tool is hidden from agents. */
  enabled: boolean;
  /** Default permission mode when the tool is first invoked. */
  permissionDefault: "allow" | "ask" | "deny";
  /**
   * Per-invocation timeout bounds for this tool. Units are per-tool:
   * ms-based tools (bash) read minMs/maxMs/defaultMs; second-based tools
   * (searchOnline/webfetch) read minSec/maxSec/defaultSec.
   */
  timeouts?: {
    minMs?: number;
    maxMs?: number;
    defaultMs?: number;
    minSec?: number;
    maxSec?: number;
    defaultSec?: number;
  };
  /** When true, the tool may make external network calls. */
  externalAccess?: boolean;
  /** Subagent-specific scheduling options. */
  subagent?: {
    slotBusyPolicy?: SlotBusyPolicy;
    pollIntervalSec?: number;
    waitTimeoutSec?: number;
  };
  /** Search providers the tool may use. */
  searchProviders?: SearchProviderConfig[];
  /** Optional skill guide attached to the tool. */
  skill?: {
    /** Skill guide markdown content for agent guidance. */
    guide: string;
    /** "soft" = optional hint, "hard" = required read, "custom" = use custom text. */
    pushMode: "soft" | "hard" | "custom";
    /** Skill ID for reading via skill tool (defaults to tool name). */
    id?: string;
    tags?: string[];
    /** Custom push text when pushMode is "custom". */
    customPushText?: string;
  };
}
