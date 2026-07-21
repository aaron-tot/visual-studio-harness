import { useState, useCallback, useMemo } from "react";
import { useConfigStore } from "../../stores/config";
import { fetchProviderModels } from "../../lib/api";
import { Plus, Trash2, RefreshCw, ToggleLeft, ToggleRight, Search } from "lucide-react";

interface ModelListProps {
  providerIndex: number;
}

export function ModelList({ providerIndex }: ModelListProps) {
  const { config, update } = useConfigStore();
  const provider = config.providers[providerIndex];
  const [fetching, setFetching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim())
      return (provider?.models ?? []).map((m, i) => ({ model: m, index: i }));
    const q = searchQuery.toLowerCase();
    return (provider?.models ?? []).reduce<{ model: (typeof provider.models)[number]; index: number }[]>(
      (acc, m, i) => {
        if (m.displayName.toLowerCase().includes(q) || m.modelName.toLowerCase().includes(q)) {
          acc.push({ model: m, index: i });
        }
        return acc;
      },
      []
    );
  }, [provider?.models, searchQuery]);

  const fetchModels = useCallback(async () => {
    // Test providers are mock — nothing to fetch
    if (provider.test) return;
    setFetching(true);
    try {
      const result = await fetchProviderModels(providerIndex);
      if (result.models?.length) {
        const current = useConfigStore.getState().config;
        const providers = [...current.providers];
        if (!providers[providerIndex]) return;
        providers[providerIndex] = { ...providers[providerIndex], models: result.models };
        await update({ ...current, providers });
      }
    } catch (err) {
      const name = provider?.displayName ?? `Provider ${providerIndex}`;
      console.warn(`[${name}] model fetch failed:`, err instanceof Error ? err.message : err);
    }
    setFetching(false);
  }, [providerIndex, update]);

  if (!provider) return null;

  const addModel = () => {
    const current = useConfigStore.getState().config;
    const providers = [...current.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      models: [
        ...providers[providerIndex].models,
        { displayName: "", modelName: "" },
      ],
    };
    update({ ...current, providers });
  };

  const removeModel = (modelIndex: number) => {
    const current = useConfigStore.getState().config;
    const providers = [...current.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      models: providers[providerIndex].models.filter((_, i) => i !== modelIndex),
    };
    update({ ...current, providers });
  };

  const toggleModel = (modelIndex: number) => {
    const current = useConfigStore.getState().config;
    const providers = [...current.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      models: providers[providerIndex].models.map((m, i) =>
        i === modelIndex ? { ...m, enabled: !(m.enabled ?? true) } : m
      ),
    };
    update({ ...current, providers });
  };

  const updateModel = (modelIndex: number, field: string, value: string) => {
    const current = useConfigStore.getState().config;
    const providers = [...current.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      models: providers[providerIndex].models.map((m, i) =>
        i === modelIndex ? { ...m, [field]: value } : m
      ),
    };
    update({ ...current, providers });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Models</h3>
        <div className="flex gap-1">
          {provider.models.length > 0 && (
            <button
              onClick={() => {
                const current = useConfigStore.getState().config;
                const allOn = provider.models.every((m) => m.enabled ?? true);
                const p = [...current.providers];
                p[providerIndex] = {
                  ...p[providerIndex],
                  models: p[providerIndex].models.map((m) => ({ ...m, enabled: !allOn })),
                };
                update({ ...current, providers: p });
              }}
              className="p-1 hover:bg-zinc-800 rounded"
              title="Toggle all models"
            >
              {provider.models.every((m) => m.enabled ?? true) ? (
                <ToggleRight size={14} />
              ) : (
                <ToggleLeft size={14} />
              )}
            </button>
          )}
          <button
            onClick={fetchModels}
            disabled={fetching || !provider.baseUrl}
            className="p-1 hover:bg-zinc-800 rounded disabled:opacity-50"
            title="Fetch models from API"
          >
            <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
          </button>
          <button onClick={addModel} className="p-1 hover:bg-zinc-800 rounded" title="Add model">
            <Plus size={16} />
          </button>
        </div>
      </div>
      {provider.models.length === 0 ? (
        <p className="text-xs text-zinc-500 px-1">No models yet. Add one or fetch from the API.</p>
      ) : (
        <div className="space-y-2">
          {provider.models.length > 5 && (
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full rounded bg-zinc-800 border border-zinc-700 pl-7 pr-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-500"
              />
            </div>
          )}
          {filteredModels.length === 0 ? (
            <p className="text-xs text-zinc-500 px-1">No models match "{searchQuery}"</p>
          ) : (
            filteredModels.map((entry) => (
              <div
                key={entry.index}
                className={`flex items-center gap-2 p-2 bg-zinc-800 rounded ${
                  entry.model.enabled ?? true ? "" : "opacity-50"
                }`}
              >
                <button
                  onClick={() => toggleModel(entry.index)}
                  className={`p-0.5 rounded ${
                    entry.model.enabled ?? true ? "text-green-400" : "text-zinc-600"
                  }`}
                >
                  {entry.model.enabled ?? true ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                </button>
                <input
                  value={entry.model.displayName}
                  onChange={(e) => updateModel(entry.index, "displayName", e.target.value)}
                  className="flex-1 rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm"
                  placeholder="Display name"
                />
                <input
                  value={entry.model.modelName}
                  onChange={(e) => updateModel(entry.index, "modelName", e.target.value)}
                  className="flex-1 rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm"
                  placeholder="Model id"
                />
                <button
                  onClick={() => removeModel(entry.index)}
                  className="p-1 hover:bg-zinc-600 rounded opacity-50 hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )))}
        </div>
      )}
    </div>
  );
}
