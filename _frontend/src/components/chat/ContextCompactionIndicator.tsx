import { useEffect, useState } from "react";
import { getEffectiveContextConfig, type SessionContextConfig } from "../../lib/api";

const TOOLTIP =
  "At the max tokens listed it will trigger a compaction to bring the token " +
  "context size down. To adjust, go to Settings → Context → Auto Compaction.";

function fmtTokens(n: number): string {
  if (!n || n <= 0) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

/**
 * Compact header badge showing current context tokens against the auto-compaction
 * trigger threshold (used / threshold + a progress bar). Only shown when auto
 * compaction is enabled AND the "show context indicator" toggle is on.
 */
export function ContextCompactionIndicator({
  sessionId,
  workspaceRoot,
  contextTokens,
}: {
  sessionId: string;
  workspaceRoot?: string;
  contextTokens?: { used: number; max: number } | undefined;
}) {
  const [cfg, setCfg] = useState<SessionContextConfig | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getEffectiveContextConfig(sessionId, workspaceRoot)
      .then((c) => { if (!cancelled) setCfg(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, workspaceRoot]);

  if (!cfg?.autoCompactionEnabled || !cfg.autoCompactionShowIndicator) return null;

  const threshold = cfg.autoCompactionTriggerTokens ?? 0;
  const used = contextTokens?.used ?? 0;
  const pct = threshold > 0 ? Math.min(100, Math.round((used / threshold) * 100)) : 0;

  return (
    <div
      className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono cursor-help select-none"
      title={TOOLTIP}
    >
      <span className="shrink-0">
        <span className="text-zinc-300">{fmtTokens(used)}</span>
        <span className="text-zinc-600"> / {fmtTokens(threshold)}</span>
      </span>
      <span className="inline-block w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden" aria-hidden>
        <span
          className={`block h-full rounded-full ${pct >= 90 ? "bg-amber-400" : "bg-zinc-500"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
