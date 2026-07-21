import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Circle } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import { fetchProviderModels } from "../../lib/api";
import { getDescriptorByDisplayName } from "../../../../_shared/provider-registry";
import { cn } from "../../lib/utils";
import { triggerPillCompact, dropdownPanel, dropdownSearch, dropdownSearchInput, dropdownSearchBar, dropdownItem, dropdownItemSelected, dropdownHeader } from "../../styles/shared";

interface ModelDropdownProps {
  triggerClassName?: string;
  providerName: string;
  modelName: string;
  onSelect: (provider: string, model: string) => void;
}

export function ModelDropdown({ triggerClassName, providerName, modelName, onSelect }: ModelDropdownProps) {
  const { config } = useConfigStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modelStatus, setModelStatus] = useState<Record<string, boolean | undefined>>({});
  const [providerAlive, setProviderAlive] = useState<Record<number, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      fetchedRef.current = false;
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setModelStatus({});
    setProviderAlive({});
    // Probe only the selected provider: probing every no-auth provider (Ollama,
    // llama.cpp) on open spammed connection errors for providers not in use.
    const idx = config.providers.findIndex(
      (p) => p.displayName === providerName && (p.enabled ?? true)
    );
    if (idx < 0) return;
    const desc = getDescriptorByDisplayName(config.providers[idx].displayName);
    if (!desc || desc.authType !== "none") return;
    fetchProviderModels(idx).then((result) => {
      const res = result as { models?: { modelName: string; isLoaded?: boolean }[]; providerAlive?: boolean };
      setProviderAlive((prev) => ({ ...prev, [idx]: !!res.providerAlive }));
      if (res.models?.length) {
        const map: Record<string, boolean | undefined> = {};
        for (const m of res.models) {
          map[m.modelName] = m.isLoaded;
        }
        setModelStatus((prev) => ({ ...prev, ...map }));
      }
    }).catch((err) => {
      const p = config.providers[idx];
      console.warn(`[Provider ${idx}] ${p?.displayName || "?"}: ${err?.message || "unreachable"} — model list unavailable`);
      setProviderAlive((prev) => ({ ...prev, [idx]: false }));
    });
  }, [open, config.providers, providerName]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  const groups: {
    provider: string;
    models: { displayName: string; modelName: string }[];
  }[] = [];
  for (const p of config.providers) {
    if (!(p.enabled ?? true) || !p.displayName.trim()) continue;
    const models = p.models
      .filter((m) => (m.enabled ?? true) && m.displayName.trim() && m.modelName.trim())
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (models.length > 0) groups.push({ provider: p.displayName, models });
  }

  const q = query.toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      models: g.models.filter((m) => m.displayName.toLowerCase().includes(q) || g.provider.toLowerCase().includes(q)),
    }))
    .filter((g) => g.models.length > 0);

  const displayLabel = modelName || "Model";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        data-testid="model-pill"
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(triggerPillCompact, triggerClassName)}
      >
        <span className="truncate max-w-[100px]">{displayLabel}</span>
        <ChevronDown size={10} className="opacity-60 shrink-0" />
      </button>

      {open && (
        <div className={`${dropdownPanel} w-64`}>
          <div className={dropdownSearchBar}>
            <div className={dropdownSearch}>
              <Search size={12} className="text-zinc-500 shrink-0" />
              <input
                data-testid="model-search"
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models..."
                className={dropdownSearchInput}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-xs text-zinc-500 text-center">No models found</p>
            ) : (
              filtered.map((g) => {
                const pIdx = config.providers.findIndex((p) => p.displayName === g.provider);
                const alive = pIdx >= 0 ? providerAlive[pIdx] : undefined;
                return (
                  <div key={g.provider}>
                    <div className={dropdownHeader}>
                      <span className="flex items-center justify-between w-full">
                        <span>{g.provider}</span>
                        {alive === true && <Circle size={7} className="fill-green-400 text-green-400 shrink-0" />}
                        {alive === false && <Circle size={7} className="fill-red-500 text-red-500 shrink-0" />}
                      </span>
                    </div>
                    {g.models.map((m) => (
                      <button
                        key={`${g.provider}/${m.displayName}`}
                        type="button"
                        onClick={() => { onSelect(g.provider, m.displayName); setOpen(false); }}
                        className={cn(
                          dropdownItem,
                          m.displayName === modelName && g.provider === providerName
                            ? dropdownItemSelected
                            : "",
                        )}
                      >
                        <span className="flex items-center justify-between min-w-0 w-full">
                          <span className="truncate">{m.displayName}</span>
                          {modelStatus[m.modelName] === true && <Circle size={7} className="fill-green-400 text-green-400 shrink-0" />}
                          {modelStatus[m.modelName] === false && <Circle size={7} className="fill-red-500 text-red-500 shrink-0" />}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
