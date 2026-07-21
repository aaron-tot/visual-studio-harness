import type { ReactNode } from "react";
import {
  formatTokens,
  formatDuration,
  formatOwnIncl,
} from "../../format/format";
import type { UsageTokenBlock } from "../../types";

export interface DetailRow {
  label: string;
  value: ReactNode;
}

export function DetailFields({ rows }: { rows: DetailRow[] }) {
  return (
    <div className="space-y-0.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-2 text-[10px]">
          <span className="text-zinc-500 shrink-0 w-24">{r.label}</span>
          <span className="text-zinc-300 min-w-0 break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Per-field own (incl) token breakdown */
export function TokenBlock({
  own,
  inclusive,
  label = "Tokens",
}: {
  own: UsageTokenBlock;
  inclusive?: UsageTokenBlock;
  label?: string;
}) {
  const incl = inclusive ?? own;
  return (
    <DetailFields
      rows={[
        {
          label,
          value: formatOwnIncl(own.totalTokens, incl.totalTokens),
        },
        {
          label: "  Input",
          value: formatOwnIncl(own.inputTokens, incl.inputTokens),
        },
        {
          label: "  Output",
          value: formatOwnIncl(own.outputTokens, incl.outputTokens),
        },
        ...((own.reasoningTokens != null && own.reasoningTokens > 0) ||
        (incl.reasoningTokens != null && incl.reasoningTokens > 0)
          ? [
              {
                label: "  Reasoning",
                value: formatOwnIncl(
                  own.reasoningTokens ?? 0,
                  incl.reasoningTokens ?? own.reasoningTokens ?? 0
                ),
              },
            ]
          : []),
        ...((own.cacheReadTokens != null && own.cacheReadTokens > 0) ||
        (incl.cacheReadTokens != null && incl.cacheReadTokens > 0)
          ? [
              {
                label: "  Cache Rd",
                value: formatOwnIncl(
                  own.cacheReadTokens ?? 0,
                  incl.cacheReadTokens ?? own.cacheReadTokens ?? 0
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

export function Divider() {
  return <div className="border-t border-zinc-800/60 my-1" />;
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "completed" || status === "success") return null;
  const colors: Record<string, string> = {
    streaming: "text-yellow-400",
    pending: "text-zinc-500",
    error: "text-red-400",
    aborted: "text-zinc-500",
  };
  return (
    <span
      className={`text-[9px] uppercase tracking-wide ${colors[status] ?? "text-zinc-500"}`}
    >
      {status}
    </span>
  );
}

export function Duration({
  ms,
  inclusiveMs,
}: {
  ms?: number;
  inclusiveMs?: number;
}) {
  if (ms == null) return null;
  if (inclusiveMs != null && inclusiveMs > ms) {
    return (
      <span className="text-zinc-400">
        {formatDuration(ms)} ({formatDuration(inclusiveMs)})
      </span>
    );
  }
  return <span className="text-zinc-400">{formatDuration(ms)}</span>;
}

/** Count with optional inclusive: `3` or `3 (5)` */
export function CountOwnIncl({
  own,
  inclusive,
}: {
  own: number;
  inclusive?: number;
}) {
  return (
    <span className="text-zinc-300">
      {formatOwnIncl(own, inclusive ?? own)}
    </span>
  );
}

// keep formatTokens available for callers that need raw
export { formatTokens };
