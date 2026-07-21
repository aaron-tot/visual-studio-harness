/**
 * Rough $/1M-token rates for cost estimates (not billing-accurate).
 * Match by substring against model id / display name (case-insensitive).
 */

export interface ModelRates {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens */
  outputPerM: number;
  label: string;
}

/** Ordered: first match wins */
const RATE_TABLE: Array<{ match: RegExp; rates: ModelRates }> = [
  {
    match: /opus|claude-4|claude-3-opus/i,
    rates: { inputPerM: 15, outputPerM: 75, label: "Claude Opus-class" },
  },
  {
    match: /sonnet|claude-3\.5|claude-3-5|claude-4-sonnet/i,
    rates: { inputPerM: 3, outputPerM: 15, label: "Claude Sonnet-class" },
  },
  {
    match: /haiku|claude-3-haiku/i,
    rates: { inputPerM: 0.25, outputPerM: 1.25, label: "Claude Haiku-class" },
  },
  {
    match: /gpt-4o|gpt-4\.1|o1|o3/i,
    rates: { inputPerM: 2.5, outputPerM: 10, label: "GPT-4o-class" },
  },
  {
    match: /gpt-4|turbo/i,
    rates: { inputPerM: 10, outputPerM: 30, label: "GPT-4-class" },
  },
  {
    match: /gpt-3\.5|mini/i,
    rates: { inputPerM: 0.5, outputPerM: 1.5, label: "GPT-mini-class" },
  },
  {
    match: /gemini.*pro|gemini-1\.5|gemini-2/i,
    rates: { inputPerM: 1.25, outputPerM: 5, label: "Gemini Pro-class" },
  },
  {
    match: /gemini|flash/i,
    rates: { inputPerM: 0.075, outputPerM: 0.3, label: "Gemini Flash-class" },
  },
  {
    match: /fake|test|mock|local/i,
    rates: { inputPerM: 0, outputPerM: 0, label: "Test/local (\$0)" },
  },
];

const DEFAULT_RATES: ModelRates = {
  inputPerM: 3,
  outputPerM: 15,
  label: "Default mid-tier estimate",
};

export function ratesForModel(model?: string | null): ModelRates {
  const m = (model ?? "").trim();
  if (!m) return DEFAULT_RATES;
  for (const row of RATE_TABLE) {
    if (row.match.test(m)) return row.rates;
  }
  return DEFAULT_RATES;
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model?: string | null
): { usd: number; rates: ModelRates } {
  const rates = ratesForModel(model);
  const usd =
    (inputTokens / 1_000_000) * rates.inputPerM +
    (outputTokens / 1_000_000) * rates.outputPerM;
  return { usd, rates };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `$${usd.toExponential(1)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
