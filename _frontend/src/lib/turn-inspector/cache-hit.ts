import type {
  StepSummary,
  StepPart,
  TurnDetail,
} from "../../../_shared/types/trace";

export interface CacheHitInfo {
  pct: number;
  cacheReadTokens: number;
  inputTokens: number;
  nextStepIndex: number;
  formatted: string;
}

export interface ToolGroup {
  stepId: number;
  stepIndex: number;
  tools: StepPart[];
  isParallel: boolean;
  cacheHit: CacheHitInfo | null;
  groupLabel: string;
  hasNextStep: boolean;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function computeCacheHit(nextStep: StepSummary | null): CacheHitInfo | null {
  if (!nextStep) return null;
  const cacheReadTokens = nextStep.cacheReadTokens ?? 0;
  const derivedInputTokens =
    nextStep.inputTokens ??
    ((nextStep.noCacheInputTokens ?? 0) + cacheReadTokens + (nextStep.cacheWriteTokens ?? 0));
  if (derivedInputTokens < 0) return null;
  const inputTokens = derivedInputTokens;
  const pct = inputTokens > 0 ? (cacheReadTokens / inputTokens) * 100 : 0;
  return {
    pct: Math.round(pct * 10) / 10,
    cacheReadTokens,
    inputTokens,
    nextStepIndex: nextStep.stepIndex,
    formatted: `${formatTokens(cacheReadTokens)} / ${formatTokens(inputTokens)} (${pct.toFixed(1)}%)`,
  };
}

function defaultCacheHit(nextStepIndex: number): CacheHitInfo {
  return {
    pct: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
    nextStepIndex,
    formatted: "0 / 0 (0.0%)",
  };
}

/**
 * Groups tool step-parts by their originating step.
 * Cache hit % for tools in step N = cache hit of the NEXT step (the SDK call
 * that received those tool results as input). All tools emitted in the same
 * step share one cache-hit value because their results are batched into a
 * single subsequent SDK call.
 */
export function computeToolGroups(
  turn: Pick<TurnDetail, "steps" | "stepParts">,
): ToolGroup[] {
  const stepsById = new Map<number, StepSummary>();
  const stepsByIndex = new Map<number, StepSummary>();
  for (const s of turn.steps) {
    if (typeof s.id === "number") stepsById.set(s.id, s);
    stepsByIndex.set(s.stepIndex, s);
  }

  const toolsByStep = new Map<number, StepPart[]>();
  for (const part of turn.stepParts) {
    if (part.type !== "tool") continue;
    const arr = toolsByStep.get(part.stepId) ?? [];
    arr.push(part);
    toolsByStep.set(part.stepId, arr);
  }

  for (const tools of toolsByStep.values()) {
    tools.sort((a, b) => a.seq - b.seq);
  }

  const groups: ToolGroup[] = [];
  for (const [stepId, tools] of toolsByStep.entries()) {
    const step = stepsById.get(stepId);
    if (!step) continue;
    const nextStep = stepsByIndex.get(step.stepIndex + 1) ?? null;
    const cacheHit = computeCacheHit(nextStep) ?? defaultCacheHit(step.stepIndex + 1);

    groups.push({
      stepId,
      stepIndex: step.stepIndex,
      tools,
      isParallel: tools.length > 1,
      cacheHit,
      hasNextStep: nextStep != null,
      groupLabel:
        tools.length > 1
          ? `Parallel Step #${step.stepIndex + 1} (${tools.length} tools)`
          : `Step #${step.stepIndex + 1}`,
    });
  }

  groups.sort((a, b) => a.stepIndex - b.stepIndex);
  return groups;
}
