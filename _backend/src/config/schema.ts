import { z } from "zod";

export const ThinkingEffortSchema = z.enum(["off", "low", "medium", "high"]);

export const ModelConfigSchema = z.object({
  displayName: z.string(),
  modelName: z.string(),
  enabled: z.boolean().optional(),
  thinkingEffort: ThinkingEffortSchema.optional(),
});

export const ProviderConfigSchema = z.object({
  displayName: z.string(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  models: z.array(ModelConfigSchema).default([]),
  enabled: z.boolean().optional(),
  test: z.boolean().optional(),
});

export const SlotBusyPolicySchema = z.enum(["wait", "fail", "ask"]);

export const AgentMdConfigSchema = z.object({
  mode: z.enum(["existing", "inline"]),
  path: z.string().optional(),
  content: z.string().optional(),
});

export const SkillMdConfigSchema = z.object({
  mode: z.enum(["existing", "custom"]),
  name: z.string().optional(),
  path: z.string().optional(),
});

export const AdditionalSystemInfoSchema = z.object({
  sections: z.array(z.enum(["runtime", "todoList", "workspaceManifest"])).default(["runtime", "todoList", "workspaceManifest"]),
  visibility: z.enum(["hidden", "collapsed", "expanded"]).default("collapsed"),
  persist: z.boolean().default(true),
  includeTime: z.boolean().default(false),
});

export const SystemPromptSectionsSchema = z.object({
  runtime: z.boolean().default(true),
  todoList: z.boolean().default(false),
  workspaceManifest: z.boolean().default(false),
});

/** Per-agent settings (runtime + MD attachments) */
export const AgentSettingsSchema = z.object({
  providerName: z.string().optional(),
  modelName: z.string().optional(),
  temperature: z.number().optional(),
  thinking: z
    .object({
      effort: ThinkingEffortSchema,
    })
    .optional(),
  maxSteps: z.number().int().positive().optional(),
  color: z.string().optional(),
  agentMd: AgentMdConfigSchema.optional(),
  skillMds: z.array(SkillMdConfigSchema).default([]),
  additionalSystemInfo: AdditionalSystemInfoSchema.optional(),
  systemPromptSections: SystemPromptSectionsSchema.optional(),
});

/** Global subagent tool settings */
export const SubagentToolSettingsSchema = z.object({
  maxConcurrent: z.number().int().positive().optional(),
  slotBusyPolicy: SlotBusyPolicySchema.optional(),
  slotPollIntervalSec: z.number().int().positive().optional(),
  slotWaitTimeoutSec: z.number().int().min(0).optional(),
});

/** Per-tool timeout/limit settings injected into tool context at runtime. */
export const BashToolSettingsSchema = z.object({
  timeoutMinMs: z.number().int().positive().default(100).optional(),
  timeoutMaxMs: z.number().int().positive().default(300_000).optional(),
  timeoutDefaultMs: z.number().int().positive().default(30_000).optional(),
});

export const WebfetchToolSettingsSchema = z.object({
  timeoutMinSec: z.number().int().positive().default(1).optional(),
  timeoutMaxSec: z.number().int().positive().default(120).optional(),
  timeoutDefaultSec: z.number().int().positive().default(30).optional(),
});

export const ToolSettingsSchema = z.object({
  bash: BashToolSettingsSchema.optional(),
  webFetch: WebfetchToolSettingsSchema.optional(),
});

export const McpServerConfigSchema = z.object({
  name: z.string().min(1, "Server name is required"),
  enabled: z.boolean().default(true),
  transport: z.enum(["stdio", "http", "tcp"]),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export const DbConfigSchema = z.object({
  path: z.string().optional(),
});

export const SystemPromptJoinersSchema = z.object({
  start: z.string().default(""),
  preGlobal: z.string().default("<global>"),
  postGlobal: z.string().default("</global>"),
  preAgent: z.string().default("<agent>"),
  postAgent: z.string().default("</agent>"),
  preSkills: z.string().default("<skills>"),
  postSkills: z.string().default("</skills>"),
  preProject: z.string().default("<project>"),
  postProject: z.string().default("</project>"),
  preRuntime: z.string().default("<runtime>"),
  postRuntime: z.string().default("</runtime>"),
  preTodoList: z.string().default("<todoList>"),
  postTodoList: z.string().default("</todoList>"),
  preWorkspaceManifest: z.string().default("<workspaceManifest>"),
  postWorkspaceManifest: z.string().default("</workspaceManifest>"),
  preExtras: z.string().default("<extras>"),
  postExtras: z.string().default("</extras>"),
  end: z.string().default(""),
});

export const WorkspaceManifestSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  maxDepth: z.number().int().positive().default(3).optional(),
  includeFiles: z.boolean().optional(),
  excludeDirs: z.array(z.string()).optional(),
  excludeExtensions: z.array(z.string()).optional(),
  includeGitignore: z.boolean().optional(),
  agents: z.array(z.string()).optional(),
  prefix: z.string().optional(),
  postfix: z.string().optional(),
});

export const SnippetConfigSchema = z.object({
  name: z.string(),
  content: z.string(),
});

export const KnowledgeBaseEmbeddingConfigSchema = z.object({
  providerId: z.string().default("ollama"),
  model: z.string().default("nomic-embed-text"),
  batchSize: z.number().int().positive().default(50),
});

export const KnowledgeBaseSearchConfigSchema = z.object({
  vectorWeight: z.number().min(0).max(1).default(0.6),
  keywordWeight: z.number().min(0).max(1).default(0.3),
  metadataWeight: z.number().min(0).max(1).default(0.1),
  topK: z.number().int().min(1).max(100).default(10),
  reranking: z.boolean().default(false),
});

export const KnowledgeBaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sourcesPath: z.string().default("knowledge/sources"),
  dbPath: z.string().default("knowledge/knowledge.db"),
  embedding: KnowledgeBaseEmbeddingConfigSchema.default({}),
  search: KnowledgeBaseSearchConfigSchema.default({}),
});

export const SearchProviderConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["exa", "parallel", "brave", "serper", "custom"]),
  name: z.string(),
  enabled: z.boolean().default(false),
  priority: z.number().int().default(0),
  apiKey: z.string().optional(),
  rateLimit: z.object({ rpm: z.number().int().positive().optional(), rpd: z.number().int().positive().optional() }).optional(),
  tags: z.array(z.string()).default([]),
  customMcpUrl: z.string().optional(),
});

export const ConfigFileSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  searchProviders: z.array(SearchProviderConfigSchema).default([]),
  knowledge: KnowledgeBaseConfigSchema.optional(),
  agents: z.record(AgentSettingsSchema).default({}),
  subagent: SubagentToolSettingsSchema.optional(),
  toolSettings: ToolSettingsSchema.optional(),
  db: DbConfigSchema.optional(),
  mcpServers: z.array(McpServerConfigSchema).default([]).optional(),
  systemPromptJoiners: SystemPromptJoinersSchema.optional(),
  additionalSystemInfo: AdditionalSystemInfoSchema.optional(),
  defaultAgent: z.string().optional(),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  autoContinueOnToolEnd: z.boolean().default(false),
  autoContinueOnToolEndMaxAttempts: z.number().int().positive().default(5),
  autoContinueOnToolEndWindowValue: z.number().int().positive().default(1),
  autoContinueOnToolEndWindowUnit: z.enum(["seconds", "minutes", "hours"]).default("minutes"),
  autoContinueOnThinkingEnd: z.boolean().default(false),
  autoContinueOnThinkingEndMaxAttempts: z.number().int().positive().default(5),
  autoContinueOnThinkingEndWindowValue: z.number().int().positive().default(1),
  autoContinueOnThinkingEndWindowUnit: z.enum(["seconds", "minutes", "hours"]).default("minutes"),
  autoContinueOnToolEndPrompt: z.string().default("<system>It was detected that you ended on a tool call without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>"),
  autoContinueOnThinkingEndPrompt: z.string().default("<system>It was detected that you ended on a reasoning block without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>"),
  keybindings: z.record(z.string()).default({}).optional(),
  testModels: z.record(z.object({
    tokensPerSecond: z.number().int().min(0).default(250),
  })).default({}),
  headless: z.boolean().default(false).optional(),
  snippets: z.array(SnippetConfigSchema).default([]),
  workspaceManifest: WorkspaceManifestSettingsSchema.optional(),
  workspaceGraph: z.boolean().optional(),
  messagePanelFullWidth: z.boolean().default(false),
  messagePanelPinnedDefault: z.boolean().default(false),
  showSessionName: z.boolean().default(false),
  includeFailedTurnsInHistory: z.boolean().default(true),
  includeToolCallsInHistory: z.boolean().default(true),
  includeReasoningInHistory: z.boolean().default(false),
  includePatchesInHistory: z.boolean().default(false),
  includeOtherPartsInHistory: z.boolean().default(false),
  contextMaxTurns: z.number().int().positive().optional(),
  /** Error message string that should trigger a streaming retry (case-insensitive substring match) */
  streamRetryErrorName: z.string().default("Streaming response failed"),
  /** Maximum number of retries for the streamRetryErrorName error (default: 3) */
  streamRetryMaxAttempts: z.number().int().min(0).default(3),
});
