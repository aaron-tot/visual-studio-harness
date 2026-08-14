import { useEffect, useState } from "react";
import { getUpdates, checkUpdates, type UpdatesInfo } from "../../lib/api";
import type { UpdateState } from "@shared/types";
import { wsClient } from "../../lib/ws";

export function UpdateIndicator() {
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUpdates()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch(() => {});
    const handler = (data: unknown) => {
      const payload = data as { updates?: UpdateState };
      const updates = payload?.updates;
      if (updates) setInfo((prev) => (prev ? { ...prev, updates } : prev));
    };
    wsClient.on("updates_updated", handler);
    return () => {
      cancelled = true;
      wsClient.off("updates_updated", handler);
    };
  }, []);

  const handleCheck = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await checkUpdates();
      setInfo(next);
    } catch {
      // Keep current state; lastError is surfaced on next refresh.
    } finally {
      setBusy(false);
    }
  };

  const appCommit = info?.appCommit ?? "";
  const state = info?.updates;
  // Hidden entirely in dev where the commit is never baked (prod-only feature).
  if (!appCommit) return null;

  const isUpdate = !!state?.available;
  const behind = state?.commitsBehind ?? 0;
  const latest = state?.latestCommit;

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="text-sm text-zinc-200">Updates</div>
      <a
        href={info?.repoUrl ? `${info.repoUrl}/commits` : "#"}
        target="_blank"
        rel="noreferrer"
        title={
          isUpdate
            ? `${behind} commit${behind === 1 ? "" : "s"} behind main`
            : latest
              ? `Up to date with ${latest.slice(0, 7)}`
              : "Update check hasn't run yet"
        }
        className={`inline-flex items-center gap-2 text-xs rounded px-2 py-1 ${
          isUpdate
            ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${isUpdate ? "bg-amber-400" : "bg-emerald-400"}`} />
        {isUpdate
          ? `Update available (${behind} commit${behind === 1 ? "" : "s"} behind) — open GitHub`
          : latest
            ? "Up to date"
            : "Checking…"}
      </a>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCheck}
          disabled={busy}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Checking…" : "Check for updates"}
        </button>
        <span className="text-[11px] text-zinc-600 font-mono">build {appCommit.slice(0, 7)}</span>
      </div>

      {state?.lastChecked && (
        <div className="text-[11px] text-zinc-600">
          Last checked {new Date(state.lastChecked).toLocaleString()}
        </div>
      )}
      {state?.lastError && (
        <div className="text-[11px] text-red-400/80">Last check failed: {state.lastError}</div>
      )}
    </div>
  );
}
