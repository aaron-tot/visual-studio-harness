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
  /** Per-step system prompt snapshot (what was actually sent for this step). */
  promptSnapshotId?: number;
  /** Verbatim provider exchange for this step. */
  rawRequestJson?: string;
  rawResponseJson?: string;
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
  id?: number;
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
  /** Per-step system prompt snapshot id (what was sent for this step). */
  promptSnapshotId?: number;
}

/** Per-step raw inspection payload served by /turns/:turnId/raw. */
export interface TurnStepRawDetail {
  stepIndex: number;
  status?: string;
  finishReason?: string;
  modelId?: string;
  providerName?: string;
  promptSnapshotId?: number;
  /** The system prompt actually used for this step (step snapshot, else turn-level). */
  systemPrompt?: string;
  /** Reconstructed SDK-level request (instructions = this step's prompt). */
  sdkRequest?: Record<string, unknown> | null;
  /** Verbatim provider request captured for this step (fallback: turn-level). */
  providerRequest?: Record<string, unknown> | null;
  /** Verbatim provider response captured for this step (fallback: turn-level). */
  response?: Record<string, unknown> | null;
  /** True when this step has its own per-step raw capture (not a turn-level fallback). */
  hasPerStepRaw: boolean;
}

export interface TurnRawCapture {
  rawRequest: unknown;
  rawResponse: unknown;
  steps: TurnStepRawDetail[];
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
