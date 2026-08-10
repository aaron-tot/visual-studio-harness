import type { UsageTokenBlock, UsageTreeSession } from "../types";
import { formatUsd, formatCostValue } from "./pricing";
import { formatTokens } from "../format/format";

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-zinc-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden min-w-0">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-zinc-400 w-10 text-right shrink-0 tabular-nums">
        {formatTokens(value)}
      </span>
    </div>
  );
}

function SegmentedInput({
  inputTokens,
  cacheReadTokens,
  max,
}: {
  inputTokens: number;
  cacheReadTokens?: number;
  max: number;
}) {
  const cache = Math.min(cacheReadTokens ?? 0, inputTokens);
  const nonCache = Math.max(0, inputTokens - cache);
  const cachePct = max > 0 ? Math.min(100, (cache / max) * 100) : 0;
  const nonCachePct = max > 0 ? Math.min(100 - cachePct, (nonCache / max) * 100) : 0;
  const hasCache = cache > 0;
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-zinc-500 w-14 shrink-0">Input</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden flex min-w-0">
        {nonCache > 0 && (
          <div
            className="h-full bg-violet-500/25"
            style={{ width: `${nonCachePct}%` }}
            title={`Non-cache input ${formatTokens(nonCache)}`}
          />
        )}
        {hasCache && (
          <div
            className="h-full bg-teal-500/30"
            style={{ width: `${cachePct}%` }}
            title={`Cache read ${formatTokens(cache)}`}
          />
        )}
      </div>
      <span className="text-zinc-400 w-12 text-right shrink-0 tabular-nums">
        {formatTokens(inputTokens)}
      </span>
    </div>
  );
}

function StackBar({
  own,
  inclusive,
}: {
  own: number;
  inclusive: number;
}) {
  const max = Math.max(inclusive, own, 1);
  const ownPct = (own / max) * 100;
  const childPct = Math.max(0, ((inclusive - own) / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
        <div
          className="bg-emerald-600/80 h-full"
          style={{ width: `${ownPct}%` }}
          title={`Own ${formatTokens(own)}`}
        />
        <div
          className="bg-sky-600/70 h-full"
          style={{ width: `${childPct}%` }}
          title={`Nested ${formatTokens(Math.max(0, inclusive - own))}`}
        />
      </div>
      <div className="flex gap-3 text-[9px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600/80" />
          own {formatTokens(own)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-600/70" />
          nested {formatTokens(Math.max(0, inclusive - own))}
        </span>
      </div>
    </div>
  );
}

/** Stored real cost from the models.dev pricing pipeline, or null when no snapshot exists. */
function costForBlock(block: UsageTokenBlock): number | null {
  if (block.costUsd !== undefined && block.costUsd !== null) {
    return block.costUsd;
  }
  return null;
}

/**
 * Cost estimate + simple token bars for a session (own vs inclusive).
 */
export function UsageCharts({
  session,
}: {
  session: UsageTreeSession;
}) {
  const ownCost = costForBlock(session.own);
  const inclCost = costForBlock(session.inclusive);

  const tokMax = Math.max(
    session.own.inputTokens,
    session.own.outputTokens,
    session.own.reasoningTokens ?? 0,
    session.inclusive.inputTokens,
    session.inclusive.outputTokens,
    1
  );

  // Real stored cost only — no fallback estimates
  const hasStoredCost = ownCost !== null || inclCost !== null;
  const costLabel = hasStoredCost ? "Cost" : "Cost (no snapshot)";
  const costCaveat = hasStoredCost
    ? "models.dev snapshot · real pricing"
    : "No pricing snapshot. Enable \"Refresh pricing at turn start\" in Settings > General > Pricing to store real cost.";

  return (
    <div className="px-3 py-2 space-y-3 border-b border-zinc-800/60">
      <div>
        <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1.5">
          {costLabel}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-200 tabular-nums">
            {formatCostValue(ownCost)}
          </span>
          {inclCost !== null && ownCost !== null && inclCost > ownCost && (
            <span className="text-[11px] text-zinc-500 tabular-nums">
              ({formatUsd(inclCost)} incl)
            </span>
          )}
        </div>
        <div className="text-[9px] text-zinc-600 mt-0.5">
          {costCaveat}
        </div>
      </div>

      <div>
        <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1.5">
          Own vs nested tokens
        </div>
        <StackBar
          own={session.own.totalTokens}
          inclusive={session.inclusive.totalTokens}
        />
      </div>

      <div className="space-y-1">
        <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">
          Token mix (own)
        </div>
        <SegmentedInput
          inputTokens={session.own.inputTokens}
          cacheReadTokens={session.own.cacheReadTokens}
          max={tokMax}
        />
        <BarRow
          label="Output"
          value={session.own.outputTokens}
          max={tokMax}
          color="bg-amber-600/70"
        />
        {(session.own.reasoningTokens ?? 0) > 0 && (
          <BarRow
            label="Reason"
            value={session.own.reasoningTokens ?? 0}
            max={tokMax}
            color="bg-rose-600/60"
          />
        )}
        {(session.own.cacheReadTokens ?? 0) > 0 && (
          <div className="flex gap-3 text-[9px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500/25" />
              non-cache {formatTokens(Math.max(0, (session.own.inputTokens ?? 0) - (session.own.cacheReadTokens ?? 0)))}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500/30" />
              cache {formatTokens(session.own.cacheReadTokens ?? 0)}
            </span>
          </div>
        )}
      </div>

      {(session.turnCount ?? 0) > 0 && (
        <TurnCostBars session={session} />
      )}
    </div>
  );
}

function TurnCostBars({ session }: { session: UsageTreeSession }) {
  const costs = session.turns.map((t) => {
    const ownCost = costForBlock(t.own);
    const inclCost = costForBlock(t.inclusive);
    return {
      n: t.turnNumber,
      own: ownCost,
      incl: inclCost,
      input: t.own.inputTokens ?? 0,
      cache: Math.min(t.own.cacheReadTokens ?? 0, t.own.inputTokens ?? 0),
    };
  });
  const max = Math.max(...costs.map((c) => Math.max(c.own ?? 0, c.incl ?? 0)), 1e-12);

  // Check if any turn has stored cost
  const hasStoredCost = costs.some((c) => c.own !== null || c.incl !== null);

  return (
    <div className="space-y-1">
      <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">
        {hasStoredCost ? "Cost by turn" : "Cost by turn (no snapshot)"}
      </div>
      {costs.map((c) => {
        const own = c.own ?? 0;
        const nonCache = Math.max(0, c.input - c.cache);
        // Bar is sized by cost; inner split reflects cache vs non-cache input.
        const nonCachePct = c.input > 0 ? (nonCache / c.input) * 100 : 100;
        const cachePct = c.input > 0 ? (c.cache / c.input) * 100 : 0;
        return (
          <div key={c.n} className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-500 w-8 shrink-0">T{c.n}</span>
            <div
              className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden flex min-w-0"
            >
              <div
                className="h-full bg-violet-500/25"
                style={{
                  width: `${(Math.min(100, (own / max) * 100)) * (nonCachePct / 100)}%`,
                }}
                title={`non-cache input ${formatTokens(nonCache)}`}
              />
              {c.cache > 0 && (
                <div
                  className="h-full bg-teal-500/30"
                  style={{
                    width: `${(Math.min(100, (own / max) * 100)) * (cachePct / 100)}%`,
                  }}
                  title={`cache read ${formatTokens(c.cache)}`}
                />
              )}
            </div>
            <span className="text-zinc-400 w-14 text-right shrink-0 tabular-nums">
              {formatCostValue(c.own)}
              {c.incl !== null && c.own !== null && c.incl > c.own ? ` (${formatUsd(c.incl)})` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
