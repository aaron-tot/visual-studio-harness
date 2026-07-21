import type { Message, MessagePartType, ProviderConfig, ThinkingEffort, TurnDebugInfo } from "../../../../_shared/types";
import type { ToolSet, LanguageModelUsage, FinishReason } from "ai";
import type { HookContext } from "../hooks";
import type { StepFinishMeta } from "./step-finish-meta";

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
  /** Full parsed finish-step meta for persistence */
  meta?: StepFinishMeta;
}

export interface StreamChatOptions {
  provider: ProviderConfig;
  model: string;
  messages: Message[];
  onToken: (token: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (e: { toolCallId: string; toolName: string; args: unknown }) => void;
  onToolResult?: (e: { toolCallId: string; toolName: string; output: unknown; isError?: boolean }) => void;
  onRetryAttempt?: (attempt: number) => void;
  onStepStart?: (info: { stepIndex: number; request?: unknown; warnings?: unknown[] }) => void;
  /** Full finish-step payload — prefer `meta` for DB writes */
  onStepFinish?: (info: StepFinishMeta) => void;
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
  /** Base retry backoff in ms (exponential: delayMs * 2^attempt). Defaults to 2000. */
  streamRetryDelayMs?: number;
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
