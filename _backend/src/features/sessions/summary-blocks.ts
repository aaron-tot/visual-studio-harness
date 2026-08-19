/**
 * Chunk planning for context-window-aware summarization.
 *
 * Given the pending un-summarized turns and a per-block token budget derived
 * from the SUMMARIZER's own max context (not the main model's), decide the
 * minimal set of oldest-first blocks such that each block's assembled
 * summarizer input (prompt + always-chained prior summary + covered turns)
 * fits within the budget, and the final block reaches the last turn.
 *
 * Pure and deterministic so both the auto-compaction path and the manual
 * /summarize-range path share identical chunking.
 */
import { countTokens, estimateMessagesTokens } from "./tokenizer";
import { getModelPricing } from "../pricing/models-dev";
import { loadConfig } from "../../storage/config";
import type { ProviderConfig, ModelConfig } from "../../../../_shared/types/config";
import { splitModelRef } from "./summarizer";

/** Default fraction of the summarizer context reserved as headroom. */
export const DEFAULT_SAFETY_MARGIN = 0.2;

/** Clamp a safety margin to [0, 0.9]. Non-finite/NaN falls back to the default. */
export function clampSafetyMargin(m: unknown): number {
  if (typeof m !== "number" || !Number.isFinite(m)) return DEFAULT_SAFETY_MARGIN;
  return Math.min(0.9, Math.max(0, m));
}

/** Per-block token budget for a summarizer window, honoring the margin. */
export function perBlockBudget(maxContext: number, margin: number): number {
  const m = clampSafetyMargin(margin);
  return Math.max(1, Math.floor(maxContext * (1 - m)));
}

/** A turn to be summarized (user/assistant text). */
export interface SummarizerTurn {
  role: "user" | "assistant";
  content: string;
}

/** A planned block = closed [startIndex..endIndex] into the original turn list. */
export interface BlockBoundary {
  startIndex: number;
  endIndex: number;
  /** Estimated input tokens for this block (fixed overhead + covered turns). */
  estimatedTokens: number;
}

/**
 * Plan chunks over `turns` for a summarizer with `budget` input tokens.
 *
 * `priorSummary` + `prompt` are the fixed per-block overhead (chained, always —
 * the summarizeIncludePriorSummary toggle does not govern inter-block continuity,
 * per R6). If the entire range fits in one block, a single boundary is returned
 * (unchanged single-summary behavior). Each turn is atomic: a single turn whose
 * token estimate alone exceeds `budget` cannot be split and must fail loudly per
 * R10.
 */
export function planChunks(options: {
  turns: SummarizerTurn[];
  prioritySummary: string | null;
  prompt: string;
  budget: number;
}): BlockBoundary[] {
  const { turns, prioritySummary, prompt, budget } = options;
  if (turns.length === 0) return [];
  if (budget <= 0) throw new Error("summary planner: non-positive budget");

  const fixedOverhead = estimateMessagesTokens(
    prioritySummary ? [{ role: "user", content: `Previous summary:\n${prioritySummary}` }] : [],
  ) + countTokens(prompt);

  // Robust per-turn costs, computed once up front.
  const turnCosts = turns.map((t) => countTokens(t.content));

  // A single turn larger than the available payload can never fit — fail loudly
  // rather than dropping content (no silent fallback).
  const payloadBudget = budget - fixedOverhead;
  if (payloadBudget <= 0) {
    throw new Error(
      `summary planner: fixed overhead (in-prompt + prior summary) exceeds budget (${budget}); cannot fit any turns`,
    );
  }
  if (turnCosts.some((c) => c > payloadBudget)) {
    throw new Error(
      "summary planner: a single turn exceeds the summarizer budget and cannot be split within a turn",
    );
  }

  const chunks: BlockBoundary[] = [];
  let start = 0;
  while (start < turns.length) {
    let used = 0;
    let end = start;
    for (; end < turns.length; end++) {
      if (used + turnCosts[end]! > payloadBudget) break;
      used += turnCosts[end]!;
    }
    // `end` is the first index NOT included. If we advanced zero turns it means
    // the head turn itself overflowed, which the guard above already excludes.
    if (end === start) {
      end = start + 1;
      used = turnCosts[start]!;
    }
    chunks.push({
      startIndex: start,
      endIndex: end - 1,
      estimatedTokens: fixedOverhead + used,
    });
    start = end;
  }
  // Ensure the final block reaches the last turn even if a tail byte overflowed
  // the nominal budget (defensive; greedy loop already guarantees coverage).
  const last = chunks[chunks.length - 1]!;
  if (last.endIndex < turns.length - 1) {
    last.endIndex = turns.length - 1;
  }
  return chunks;
}

/**
 * Resolve the summarizer model's max input context from the models.dev catalog
 * (PricingSnapshot.limitContext). Returns `null` when the model has no
 * resolvable limit (R1/R10) — callers must fail loudly, never guess a window.
 */
export async function resolveSummarizerContextLimit(options: {
  modelRef: string;
  fallbackModelRef?: string | null;
  dataDir: string;
}): Promise<number | null> {
  const config = await loadConfig(options.dataDir);
  const providers = config.providers ?? [];

  const tryRef = async (ref: string): Promise<number | null> => {
    const parsed = splitModelRef(ref);
    if (!parsed) return null;
    const provider: ProviderConfig | undefined = providers.find(
      (p: ProviderConfig) => p.displayName === parsed.providerName && p.enabled !== false,
    ) ?? providers.find((p: ProviderConfig) => p.enabled !== false);
    if (!provider) return null;
    const model: ModelConfig | undefined = provider.models.find(
      (m: ModelConfig) => m.displayName === parsed.modelName && m.enabled !== false,
    ) ?? provider.models.find((m: ModelConfig) => m.enabled !== false);
    if (!model) return null;
    try {
      const snap = await getModelPricing(provider, model.modelName, config, options.dataDir);
      return snap?.found && typeof snap.limitContext === "number" && snap.limitContext > 0
        ? snap.limitContext
        : null;
    } catch {
      return null;
    }
  };

  const primary = await tryRef(options.modelRef);
  if (primary != null) return primary;
  if (options.fallbackModelRef) return tryRef(options.fallbackModelRef);
  return null;
}
