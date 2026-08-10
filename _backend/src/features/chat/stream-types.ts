import type { Message, MessagePartType, ProviderConfig, ThinkingEffort, TurnDebugInfo } from "../../../../_shared/types";
import type { ToolSet, LanguageModelUsage, FinishReason, PrepareStepFunction } from "ai";
import type { HookContext } from "../hooks";
import type { StepFinishMeta } from "./step-finish-meta";
import type { StepToolBatchBeforePayload, StepToolBatchAfterPayload } from "../../../../_shared/types/step-batch";

export interface StreamStepSummary {
  stepIndex: number;
  finishReason?: FinishReason | string;
  rawFinishReason?: string;
  usage?: Partial<LanguageModelUsage>;
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
  responseId?: string;
  responseModelId?: string;
  warnings?: unknown[];
  meta?: StepFinishMeta;
  /** Verbatim provider exchange attributed to this step. */
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}

export interface StreamChatOptions {
  provider: ProviderConfig;
  model: string;
  messages: Message[];
  onToken: (token: string, seq: number, tps?: number) => void;
  onReasoning?: (delta: string, seq: number, tps?: number) => void;
  onToolCall?: (e: { toolCallId: string; toolName: string; args: unknown; stepIndex: number }) => void;
  onToolResult?: (e: { toolCallId: string; toolName: string; output: unknown; isError?: boolean }) => void;
  onRetryAttempt?: (attempt: number) => void;
  onStepStart?: (info: { stepIndex: number; request?: unknown; warnings?: unknown[] }) => void;
  /** Full finish-step payload — prefer `meta` for DB writes */
  onStepFinish?: (info: StepFinishMeta) => void;
  /** Fires once per step before the first tool executes, with the full tool-call list. */
  onToolBatchStart?: (e: StepToolBatchBeforePayload) => void | Promise<void>;
  /** Fires once per step after all tools complete, with calls + results. */
  onToolBatchEnd?: (e: StepToolBatchAfterPayload) => void | Promise<void>;
  /** Per-step instructions rebuild. Must return the complete system block, never a delta. */
  prepareStep?: PrepareStepFunction<ToolSet>;
  /** Conversation id sent to providers via identity headers (X-Session-Id / x-session-affinity). */
  sessionId?: string;
  /** Parent conversation id for subagent turns (x-parent-session-id). */
  parentSessionId?: string;
  /** Fixed-provider routing for OpenAI-compatible/OpenRouter endpoints. */
  providerRouting?: { order?: string[]; allowFallbacks?: boolean };
  tools?: ToolSet;
  maxSteps?: number;
  temperature?: number;
  thinkingEffort?: ThinkingEffort;
  signal?: AbortSignal;
  hookCtx?: HookContext;
  modelSpeed?: number;
  workspaceRoot?: string;
  /** Error message substring that triggers a retry (case-insensitive) */
  streamRetryErrorName?: string;
  /** Maximum number of retries for the streamRetryErrorName error */
  streamRetryMaxAttempts?: number;
  /** Enable automatic retry on provider errors */
  streamRetryEnabled?: boolean;
  /** Time window for retry rate limiting */
  streamRetryWindowValue?: number;
  streamRetryWindowUnit?: "seconds" | "minutes" | "hours";
  /** Base delay in ms before first retry */
  streamRetryBaseDelayMs?: number;
  /** Additional delay per retry (ms). 0 = no progressive increase. */
  streamRetryProgressiveDelayMs?: number;
}

export interface StreamChatResult {
  content: string;
  parts?: MessagePartType[];
  steps?: StreamStepSummary[];
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  finishReason?: string;
  rawFinishReason?: string;
  error?: string;
  rawError?: string;
  errorIsCustom?: boolean;
  debugInfo?: TurnDebugInfo;
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}
