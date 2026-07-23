import { useState, useEffect, useCallback } from "react";
import { getGraphStatus, triggerGraphReindex } from "../../../../lib/api";
import type { GraphStatusResponse } from "../../../../lib/api";
import { EmptyState, PanelButton } from "../ui";

function relativeTime(ms: number): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function StateBadge({ state }: { state: GraphStatusResponse["state"] }) {
  const colors = {
    idle: "bg-zinc-700 text-zinc-400",
    indexing: "bg-amber-800/60 text-amber-300",
    watching: "bg-emerald-800/60 text-emerald-300",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${colors[state]}`}>
      {state}
    </span>
  );
}

export function StatusView() {
  const [status, setStatus] = useState<GraphStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getGraphStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.state !== "indexing") return;
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.state, fetchStatus]);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await triggerGraphReindex();
      await fetchStatus();
    } finally {
      setReindexing(false);
    }
  };

  if (loading) return <EmptyState>Loading graph status…</EmptyState>;
  if (error) return <EmptyState><span className="text-red-400">Error: {error}</span></EmptyState>;
  if (!status) return <EmptyState>No status data</EmptyState>;

  return (
    <div className="px-3 py-2 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-300 font-medium">Graph Status</span>
          <StateBadge state={status.state} />
        </div>
        <PanelButton onClick={handleReindex} disabled={reindexing}>
          {reindexing ? "Indexing…" : "Reindex"}
        </PanelButton>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Files" value={status.fileCount} />
        <StatCard label="Folders" value={status.folderCount} />
        <StatCard label="Symbols" value={status.symbolCount} />
      </div>

      <div className="space-y-1.5">
        <InfoRow label="Languages" value={status.languages.length ? status.languages.join(", ") : "none"} />
        <InfoRow label="Last indexed" value={relativeTime(status.lastIndexedAt)} />
        <InfoRow label="DB path" value={status.dbPath || "not initialized"} title={status.dbPath} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-zinc-800/60 px-2 py-1.5 text-center">
      <div className="text-[13px] text-zinc-200 font-mono">{value}</div>
      <div className="text-[9px] text-zinc-500">{label}</div>
    </div>
  );
}

function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-start gap-2 text-[10px]">
      <span className="text-zinc-500 shrink-0 w-16">{label}</span>
      <span className="text-zinc-300 truncate font-mono" title={title}>{value}</span>
    </div>
  );
}
