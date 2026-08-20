import { useEffect, useState } from "react";
import { getEffectiveContextConfig, type SessionContextConfig } from "../../lib/api";
import { useChatStore } from "../../features/chat/store";

const TOOLTIP =
  "At the max tokens listed, the next send summarizes first, then your " +
  "message. To adjust, go to Settings → Context → Auto Compaction.";

function fmtTokens(n: number): string {
  if (!n || n <= 0) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

/**
 * Compact header badge showing current context tokens against the auto-compaction
 * trigger threshold (used / threshold + a progress bar). Only shown when auto
 * compaction is enabled AND the "show context indicator" toggle is on.
 *
 * `used` comes from the live per-step `context_tokens` WS event (the provider's
 * input+cache-read token count for the last step), so it updates on every step
 * return rather than sitting at 0.
 */
export function ContextCompactionIndicator({
  sessionId,
  workspaceRoot,
}: {
  sessionId: string | null;
  workspaceRoot?: string;
}) {
  const contextTokens = useChatStore((s) => s.contextTokens);
  // Re-fetch the effective config whenever a settings save bumps the version,
  // so the threshold/label reflects edits (e.g. changing 20k → 50k) immediately.
  const contextConfigVersion = useChatStore((s) => s.contextConfigVersion);
  const [cfg, setCfg] = useState<SessionContextConfig | null>(null);

  useEffect(() => {
    if (!sessionId) { setCfg(null); return; }
    let cancelled = false;
    getEffectiveContextConfig(sessionId, workspaceRoot)
      .then((c) => { if (!cancelled) setCfg(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, workspaceRoot, contextConfigVersion]);

  if (!cfg?.autoCompactionEnabled || !cfg.autoCompactionShowIndicator) return null;

  // Threshold comes from the live effective config (reflects settings edits);
  // used comes from the store (backend per-step / session-load snapshot).
  const threshold = cfg.autoCompactionTriggerTokens ?? 0;
  const used = contextTokens?.used ?? 0;
  const pct = threshold > 0 ? Math.min(100, Math.round((used / threshold) * 100)) : 0;
  const willFire = contextTokens?.pending === true
    || (contextTokens?.pending !== false && threshold > 0 && used >= threshold);
  const hasData = contextTokens != null;

  return (
    <div className="inline-flex items-center gap-1.5 mx-1">
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-zinc-700/60 bg-zinc-900/70 text-[10px] text-zinc-300 font-mono cursor-help select-none"
        title={TOOLTIP}
        data-testid="context-compaction-indicator"
      >
        <span className="shrink-0">
          <span className="text-zinc-100">{fmtTokens(contextTokens?.used ?? 0)}</span>
          <span className="text-zinc-500">/{fmtTokens(threshold)}</span>
        </span>
        <span className="inline-block w-16 h-1.5 rounded-full bg-zinc-700/70 overflow-hidden" aria-hidden>
          <span
            className={`block h-full rounded-full ${pct >= 90 ? "bg-amber-400" : "bg-zinc-400"}`}
            style={{ width: `${hasData ? Math.max(pct, 2) : 0}%` }}
          />
        </span>
      </div>
      {willFire && (
        <span
          data-testid="context-compaction-will-fire"
          className="text-[10px] text-amber-400 whitespace-nowrap select-none"
        >
          will fire before next message
        </span>
      )}
    </div>
  );
}
