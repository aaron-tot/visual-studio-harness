/**
 * View-model types for Usage V2 (live API).
 * Keep in sync with GET /api/sessions/:id/usage-tree (Phase 3).
 */

export interface UsageTokenBlock {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface UsageTreeStep {
  stepIndex: number;
  status?: string;
  finishReason?: string;
  modelId?: string;
  providerName?: string;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  durationMs?: number;
  subagents?: UsageTreeSubagent[];
}

export interface UsageTreeTurn {
  turnId: number | string;
  turnNumber: number;
  userContentPreview?: string;
  modelName?: string;
  providerName?: string;
  agentName?: string;
  contextTurnNumbers: number[];
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  durationMs?: number;
  inclusiveDurationMs?: number;
  stepCount?: number;
  inclusiveStepCount?: number;
  status?: string;
  steps: UsageTreeStep[];
}

export interface UsageTreeSubagent {
  childSessionId: string;
  taskLabel?: string;
  kind: "spawn" | "resume";
  childTurnNumber?: number;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  child?: UsageTreeSession;
}

export interface UsageTreeSession {
  sessionId: string;
  label?: string;
  own: UsageTokenBlock;
  inclusive: UsageTokenBlock;
  turnCount?: number;
  inclusiveTurnCount?: number;
  stepCount?: number;
  inclusiveStepCount?: number;
  durationMs?: number;
  inclusiveDurationMs?: number;
  turns: UsageTreeTurn[];
}
