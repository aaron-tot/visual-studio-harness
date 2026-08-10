/**
 * USD cost display helpers.
 *
 * Cost is the real stored value from the models.dev pricing pipeline
 * (turns.cost_usd / steps.cost_usd). There is intentionally NO fallback
 * estimate table — an unknown model shows "no pricing snapshot" instead of
 * fabricated numbers.
 */

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `${usd.toExponential(1)}`;
  if (usd < 0.01) return `${usd.toFixed(4)}`;
  if (usd < 1) return `${usd.toFixed(3)}`;
  return `${usd.toFixed(2)}`;
}

/**
 * Render a cost value on the UI.
 * - `null`/`undefined` → "—" (no pricing snapshot, unknown)
 * - `0` → "free" (a found free-model snapshot, or a sum of free models)
 * - otherwise → numeric `formatUsd`
 *
 * `cost_usd === 0` only ever arises from a found snapshot with zero rates (a free
 * model) or a sum of free models, so it is genuinely "free" — never a placeholder.
 */
export function formatCostValue(costUsd: number | null | undefined): string {
  if (costUsd === undefined || costUsd === null) return "—";
  if (costUsd === 0) return "free";
  return formatUsd(costUsd);
}
