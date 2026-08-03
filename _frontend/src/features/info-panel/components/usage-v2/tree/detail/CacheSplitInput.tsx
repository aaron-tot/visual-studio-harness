import { formatTokens } from "../../format/format";

/**
 * Segmented input bar splitting prompt tokens into non-cache (violet) and
 * cache-read (teal) portions. Used for any token block (session, turn, step,
 * subagent). When there's no cache info it behaves like a plain bar.
 */
export function CacheSplitInput({
  inputTokens,
  cacheReadTokens,
  max,
  rowMax = 1,
}: {
  inputTokens?: number;
  cacheReadTokens?: number;
  /** Scale between 0..1; if omitted, bar width is relative to max (biggest bar). */
  max?: number;
  rowMax?: number;
}) {
  const input = Math.max(0, inputTokens ?? 0);
  const cache = Math.min(cacheReadTokens ?? 0, input);
  const nonCache = input - cache;
  const hasCache = cache > 0;
  // Percentage of the overall bar width for this bar and its segments.
  const totalPct = max != null && max > 0 ? (input / max) * 100 : 100;
  const cachePct = hasCache && totalPct > 0 ? (cache / input) * totalPct : 0;
  const nonCachePct = nonCache > 0 ? totalPct - cachePct : 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex h-1.5 min-w-16 rounded-full bg-zinc-800 overflow-hidden align-middle">
        {nonCache > 0 && (
          <span
            className="h-full bg-violet-600/70"
            style={{ width: `${nonCachePct}%` }}
            title={`Non-cache input ${formatTokens(nonCache)}`}
          />
        )}
        {hasCache && (
          <span
            className="h-full bg-teal-500/80"
            style={{ width: `${cachePct}%` }}
            title={`Cache read ${formatTokens(cache)}`}
          />
        )}
      </span>
      <span className="text-zinc-300 tabular-nums">
        {formatTokens(input)}
      </span>
      {hasCache && (
        <span className="text-teal-400/90 tabular-nums" title="cache read">
          {formatTokens(cache)} c
        </span>
      )}
    </span>
  );
}
