import { useEffect, useState } from "react";
import { useConfigStore } from "../../stores/config";
import type { ConfigFile } from "../../../../_shared/types";

interface SnapshotView {
  found: boolean;
  modelId: string;
  providerId: string;
  rates: { inputPerM: number; outputPerM: number; cacheReadPerM: number; cacheWritePerM: number };
  fetchedAt: string;
  error?: string;
}

export function PricingSettingsCard() {
  const { config, update } = useConfigStore();
  const [refreshResult, setRefreshResult] = useState<{
    success: boolean;
    catalogRefreshed?: boolean;
    snapshot?: SnapshotView;
    error?: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Show the last time the models.dev catalog was fetched (on mount / when enabled).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pricing/status");
        const data = await res.json();
        if (!cancelled && data?.catalogUpdatedAt) setLastUpdated(data.catalogUpdatedAt);
      } catch {
        /* ignore — stays "never" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const patch = (partial: Partial<ConfigFile>) => {
    const current = useConfigStore.getState().config;
    update({ ...current, ...partial });
  };

  const pricing = config.pricing ?? {};
  const enabled = pricing.enabled ?? false;
  const defaultProvider = config.defaultProvider ?? "";
  const defaultModel = config.defaultModel ?? "";
  // Resolve a concrete provider:model for the preview (which snapshot "Refresh
  // now" returns). Tolerant of a placeholder defaultModel like "Default Model".
  const provider =
    config.providers.find((p) => p.displayName === defaultProvider) ??
    config.providers.find((p) => p.enabled !== false) ??
    config.providers[0];
  const model =
    provider?.models.find((m) => m.modelName === defaultModel && m.enabled !== false) ??
    provider?.models.find((m) => m.modelName === defaultModel) ??
    provider?.models.find((m) => m.enabled !== false) ??
    provider?.models[0];

  // "Refresh now" always works — it forces a FULL catalog download (bypass TTL).
  // provider/model are only used to also fetch that model's snapshot for display.
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshResult(null);

    try {
      const params = new URLSearchParams();
      if (provider) params.set("provider", provider.displayName);
      if (model) params.set("model", model.modelName);
      const qs = params.toString();
      const res = await fetch(`/api/pricing/refresh${qs ? `?${qs}` : ""}`, { method: "POST" });
      const data = await res.json();
      if (data?.catalogUpdatedAt) setLastUpdated(data.catalogUpdatedAt);
      if (data?.snapshot) {
        setRefreshResult({ success: true, catalogRefreshed: true, snapshot: data.snapshot });
      } else if (data?.ok) {
        setRefreshResult({ success: true, catalogRefreshed: true });
      } else {
        setRefreshResult({ success: false, error: data?.error ?? "Unknown error" });
      }
    } catch (e) {
      setRefreshResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatRate = (rate: number) => `$${rate.toFixed(2)}/M`;

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <div className="text-sm text-zinc-200 mb-2">Pricing (models.dev)</div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => patch({ pricing: { ...pricing, enabled: e.target.checked } })}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
        />
        <div>
          <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
            Pricing refresh
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            When on, the price for each turn's/step's model is looked up from the
            models.dev cache and stored on the turn/step (cost_usd). The network is
            only contacted when the cached price is older than the TTL below — the
            checks themselves are instant in-memory lookups.
          </div>
          <div className="text-[11px] text-zinc-600 mt-1">
            Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : "never"}
          </div>
        </div>
      </label>

      <div className="ml-7 space-y-2" style={{ opacity: enabled ? 1 : 0.5 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Cache TTL (minutes)</span>
          <input
            type="number"
            min={1}
            max={10080}
            value={pricing.cacheTtlMinutes ?? 60}
            onChange={(e) => patch({ pricing: { ...pricing, cacheTtlMinutes: Math.max(1, Number(e.target.value)) } })}
            disabled={!enabled}
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-xs text-zinc-500">
            Re-downloads the models.dev catalog at most once per TTL window.
          </span>
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRefreshing ? "Refreshing…" : "Refresh now"}
          </button>
          <span className="text-[11px] text-zinc-500">
            Forces a full catalog re-download (bypasses TTL).
            {provider && model ? ` Preview: ${provider.displayName} / ${model.modelName}` : ""}
          </span>
        </div>

        {refreshResult && (
          <div className="text-[11px] font-mono space-y-1 p-2 bg-zinc-900/50 rounded border border-zinc-800">
            {refreshResult.success ? (
              <>
                <div className="text-green-400">✓ {refreshResult.catalogRefreshed ? "Catalog refreshed (full download)" : "Done"}</div>
                {refreshResult.snapshot && (
                  <>
                    <div className={refreshResult.snapshot.found ? "text-green-400" : "text-amber-400"}>
                      {refreshResult.snapshot.found ? "✓ Found" : "✗ Not found"}
                    </div>
                    <div>Model: {refreshResult.snapshot.modelId}</div>
                    <div>Provider: {refreshResult.snapshot.providerId}</div>
                    <div>Rates: in {formatRate(refreshResult.snapshot.rates.inputPerM)}, out {formatRate(refreshResult.snapshot.rates.outputPerM)}, cache-r {formatRate(refreshResult.snapshot.rates.cacheReadPerM)}, cache-w {formatRate(refreshResult.snapshot.rates.cacheWritePerM)}</div>
                    <div>Fetched: {new Date(refreshResult.snapshot.fetchedAt).toLocaleString()}</div>
                    {refreshResult.snapshot.error && <div className="text-red-400">Error: {refreshResult.snapshot.error}</div>}
                  </>
                )}
              </>
            ) : (
              <div className="text-red-400">Error: {refreshResult.error ?? "Unknown error"}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
