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
});

/** Global subagent tool settings */
export const SubagentToolSettingsSchema = z.object({
  maxConcurrent: z.number().int().positive().optional(),
  slotBusyPolicy: SlotBusyPolicySchema.optional(),
  slotPollIntervalSec: z.number().int().positive().optional(),
  slotWaitTimeoutSec: z.number().int().min(0).optional(),
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
  afterGlobal: z.string().default("\n\n"),
  afterAgentMd: z.string().default("\n\n"),
  afterSkillMds: z.string().default("\n\n"),
  afterProject: z.string().default("\n\n"),
  afterRuntime: z.string().default("\n\n"),
  afterTodoList: z.string().default("\n\n"),
  afterExtras: z.string().default("\n\n"),
  end: z.string().default(""),
});

export const SnippetConfigSchema = z.object({
  name: z.string(),
  content: z.string(),
});

export const ConfigFileSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  agents: z.record(AgentSettingsSchema).default({}),
  subagent: SubagentToolSettingsSchema.optional(),
  db: DbConfigSchema.optional(),
  mcpServers: z.array(McpServerConfigSchema).default([]).optional(),
  systemPromptJoiners: SystemPromptJoinersSchema.optional(),
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
  messagePanelFullWidth: z.boolean().default(false),
  messagePanelPinnedDefault: z.boolean().default(false),
  showSessionName: z.boolean().default(false),
  /** Error message string that should trigger a streaming retry (case-insensitive substring match) */
  streamRetryErrorName: z.string().default("Streaming response failed"),
  /** Maximum number of retries for the streamRetryErrorName error (default: 3) */
  streamRetryMaxAttempts: z.number().int().min(0).default(3),
});
