import type { UsageTokenBlock, UsageTreeSession } from "../types";
import { estimateCostUsd, formatUsd, ratesForModel } from "./pricing";
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

function costForBlock(block: UsageTokenBlock, model?: string | null) {
  return estimateCostUsd(block.inputTokens, block.outputTokens, model);
}

/**
 * Cost estimate + simple token bars for a session (own vs inclusive).
 */
export function UsageCharts({
  session,
}: {
  session: UsageTreeSession;
}) {
  const modelHint =
    session.turns[0]?.modelName ??
    session.turns[0]?.steps[0]?.modelId ??
    null;
  const ownCost = costForBlock(session.own, modelHint);
  const inclCost = costForBlock(session.inclusive, modelHint);
  const rates = ratesForModel(modelHint);

  const tokMax = Math.max(
    session.own.inputTokens,
    session.own.outputTokens,
    session.own.reasoningTokens ?? 0,
    session.inclusive.inputTokens,
    session.inclusive.outputTokens,
    1
  );

  return (
    <div className="px-3 py-2 space-y-3 border-b border-zinc-800/60">
      <div>
        <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1.5">
          Est. cost
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-200 tabular-nums">
            {formatUsd(ownCost.usd)}
          </span>
          {inclCost.usd > ownCost.usd && (
            <span className="text-[11px] text-zinc-500 tabular-nums">
              ({formatUsd(inclCost.usd)} incl)
            </span>
          )}
        </div>
        <div className="text-[9px] text-zinc-600 mt-0.5">
          {rates.label}
          {modelHint ? ` · ${modelHint}` : ""} · rough $/M tok estimate, not billing (IGNORE THESE $ FIGURES THEY ARE NOT CURRENLY REAL)
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
        <BarRow
          label="Input"
          value={session.own.inputTokens}
          max={tokMax}
          color="bg-violet-600/70"
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
      </div>

      {(session.turnCount ?? 0) > 0 && (
        <TurnCostBars session={session} />
      )}
    </div>
  );
}

function TurnCostBars({ session }: { session: UsageTreeSession }) {
  const costs = session.turns.map((t) => {
    const model = t.modelName ?? t.steps[0]?.modelId;
    return {
      n: t.turnNumber,
      own: costForBlock(t.own, model).usd,
      incl: costForBlock(t.inclusive, model).usd,
    };
  });
  const max = Math.max(...costs.map((c) => Math.max(c.own, c.incl)), 1e-12);

  return (
    <div className="space-y-1">
      <div className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">
        Est. cost by turn
      </div>
      {costs.map((c) => (
        <div key={c.n} className="flex items-center gap-2 text-[10px]">
          <span className="text-zinc-500 w-8 shrink-0">T{c.n}</span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden flex min-w-0">
            <div
              className="h-full bg-emerald-600/80"
              style={{ width: `${(c.own / max) * 100}%` }}
              title={`own ${formatUsd(c.own)}`}
            />
            {c.incl > c.own && (
              <div
                className="h-full bg-sky-600/60"
                style={{ width: `${((c.incl - c.own) / max) * 100}%` }}
                title={`incl ${formatUsd(c.incl)}`}
              />
            )}
          </div>
          <span className="text-zinc-400 w-14 text-right shrink-0 tabular-nums">
            {formatUsd(c.own)}
            {c.incl > c.own ? ` (${formatUsd(c.incl)})` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
