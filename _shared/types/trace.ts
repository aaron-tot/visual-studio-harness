export type TurnStatus = "pending" | "streaming" | "success" | "error" | "aborted";
export type StepStatus = "pending" | "streaming" | "completed" | "error";

export interface TraceTurn {
  id: number;
  sessionId: string;
  turnNumber: number;
  userContent: string;
  userTimestamp: string;
  status: TurnStatus;
  success?: boolean;
  agentName?: string;
  modelName?: string;
  providerName?: string;
  maxSteps?: number;
  temperature?: number;
  thinkingEffort?: string;
  systemPromptSnapshotId?: number;
  toolsSnapshotId?: number;
  finishReason?: string;
  errorMessage?: string;
  errorRaw?: string;
  errorIsCustom?: boolean;
  durationMs?: number;
  startedAt: string;
  completedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  stepCount?: number;
  rawRequestJson?: string;
  rawResponseJson?: string;
}

export interface TraceStep {
  id: number;
  sessionId: string;
  turnId: number;
  stepIndex: number;
  status: StepStatus;
  providerName?: string;
  modelId?: string;
  callId?: string;
  responseId?: string;
  responseModelId?: string;
  finishReason?: string;
  rawFinishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheInputTokens?: number;
  usageRawJson?: string;
  stepTimeMs?: number;
  responseTimeMs?: number;
  timeToFirstOutputMs?: number;
  effectiveOutputTps?: number;
  outputTps?: number;
  inputTps?: number;
  toolExecutionMsJson?: string;
  performanceJson?: string;
  providerMetadataJson?: string;
  warningsJson?: string;
  requestMetaJson?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TraceStepPart {
  id: number;
  sessionId: string;
  turnId: number;
  stepId: number;
  type: string;
  seq: number;
  status?: string;
  toolCallId?: string;
  toolName?: string;
  parentToolCallId?: string;
  data: string;
  createdAt: string;
  updatedAt?: string;
}

export interface StepPart {
  id: number;
  stepId: number;
  type: "tool" | "text" | "reasoning" | "tool-result";
  seq: number;
  toolCallId?: string;
  toolName?: string;
  parentToolCallId?: string;
  data?: Record<string, unknown>;
  status?: string;
}

export interface TurnContextRef {
  id: number;
  turnId: number;
  contextTurnId: number;
  position: number;
}

// ── Read-model types ─────────────────────────────────────────────────

export interface TurnSummary {
  turnNumber: number;
  status: TurnStatus;
  userContentPreview?: string;
  modelName?: string;
  providerName?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  stepCount?: number;
  success?: boolean;
  contextTurnNumbers: number[];
}

export interface StepSummary {
  stepIndex: number;
  status: string;
  finishReason?: string;
  rawFinishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheInputTokens?: number;
  stepTimeMs?: number;
  responseTimeMs?: number;
  timeToFirstOutputMs?: number;
  effectiveOutputTps?: number;
  outputTps?: number;
  inputTps?: number;
  modelId?: string;
  responseModelId?: string;
  providerName?: string;
  responseId?: string;
}

export interface TurnDetail extends TurnSummary {
  userContent: string;
  userTimestamp: string;
  agentName?: string;
  systemPrompt?: string;
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
  steps: StepSummary[];
  stepParts: StepPart[];
  errorMessage?: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  turnCount: number;
  stepCount: number;
}
