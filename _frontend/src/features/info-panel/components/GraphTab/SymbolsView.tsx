import { useState, useEffect, useMemo } from "react";
import { getGraphSymbols } from "../../../../lib/api";
import type { GraphSymbolMatch } from "../../../../lib/api";
import { EmptyState, PanelInput } from "../ui";

const KIND_ICONS: Record<string, string> = {
  function: "ƒ",
  class: "C",
  interface: "I",
  enum: "E",
  variable: "V",
  type: "T",
};

const KIND_COLORS: Record<string, string> = {
  function: "text-blue-400",
  class: "text-emerald-400",
  interface: "text-purple-400",
  enum: "text-amber-400",
  variable: "text-zinc-400",
  type: "text-cyan-400",
};

const KIND_FILTERS = ["all", "function", "class", "interface", "enum", "variable", "type"] as const;
type KindFilter = typeof KIND_FILTERS[number];

export function SymbolsView() {
  const [symbols, setSymbols] = useState<GraphSymbolMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    getGraphSymbols()
      .then((r) => { setSymbols(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed"); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    let result = symbols;
    if (kindFilter !== "all") {
      result = result.filter((s) => s.symbol.kind === kindFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) => s.symbol.name.toLowerCase().includes(q) || s.filePath.toLowerCase().includes(q)
      );
    }
    return result;
  }, [symbols, search, kindFilter]);

  if (loading) return <EmptyState>Loading symbols…</EmptyState>;
  if (error) return <EmptyState><span className="text-red-400">Error: {error}</span></EmptyState>;

  return (
    <div className="flex flex-col">
      <div className="px-2 py-1 border-b border-zinc-800/50 space-y-1">
        <PanelInput
          placeholder="Search symbols…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1 flex-wrap">
          {KIND_FILTERS.map((k) => (
            <button
              key={k}
              className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
                kindFilter === k ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setKindFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="px-2 py-0.5 text-[9px] text-zinc-600 border-b border-zinc-800/50">
        {filtered.length} symbols
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((s) => (
          <div key={s.symbol.id}>
            <div
              className="flex items-center gap-2 px-3 py-1 cursor-default hover:bg-zinc-800/50"
              onClick={() => setExpanded(expanded === s.symbol.id ? null : s.symbol.id)}
            >
              <span className={`text-[10px] font-bold w-3 ${KIND_COLORS[s.symbol.kind] || "text-zinc-400"}`}>
                {KIND_ICONS[s.symbol.kind] || "?"}
              </span>
              <span className="text-[11px] text-zinc-200 font-mono truncate flex-1">{s.symbol.name}</span>
              <span className="text-[9px] text-zinc-600 shrink-0">{s.symbol.startLine}–{s.symbol.endLine}</span>
            </div>
            {expanded === s.symbol.id && (
              <div className="px-4 py-1.5 border-t border-zinc-800/30 bg-zinc-900/30 space-y-1">
                <InfoLine label="File" value={s.filePath} />
                <InfoLine label="Kind" value={s.symbol.kind} />
                <InfoLine label="Exported" value={s.symbol.exported ? "yes" : "no"} />
                {s.symbol.async && <InfoLine label="Async" value="yes" />}
                {s.symbol.static && <InfoLine label="Static" value="yes" />}
                <InfoLine label="Visibility" value={s.symbol.visibility} />
                {s.symbol.signature && <InfoLine label="Signature" value={s.symbol.signature} />}
                <InfoLine label="Hash" value={s.symbol.structuralHash} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-[10px]">
      <span className="text-zinc-500 shrink-0 w-16">{label}</span>
      <span className="text-zinc-300 font-mono truncate" title={value}>{value}</span>
    </div>
  );
}
