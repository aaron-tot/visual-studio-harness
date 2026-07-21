import { useState } from "react";
import { useConfigStore } from "../../stores/config";
import { fetchProviderModels } from "../../lib/api";
import { Plus, Trash2, Sparkles, Wrench, ToggleLeft, ToggleRight } from "lucide-react";
import type { ProviderConfig } from "../../../../_shared/types";
import { PRECONFIGURED_PROVIDERS } from "../../../../_shared/provider-registry";
import type { ProviderDescriptor } from "../../../../_shared/provider-registry";

function descriptorToProviderConfig(desc: ProviderDescriptor): ProviderConfig {
  return {
    displayName: desc.name,
    baseUrl: desc.baseUrl,
    models: desc.defaultModels ?? [{ displayName: "Default Model", modelName: "default" }],
    test: desc.id === "test" || undefined,
  };
}

const pickerItems = PRECONFIGURED_PROVIDERS.map((d) => ({
  name: d.name,
  icon: d.icon,
  provider: descriptorToProviderConfig(d),
}));

interface ProviderListProps {
  onSelect: (index: number) => void;
  selectedIndex: number | null;
}

export function ProviderList({ onSelect, selectedIndex }: ProviderListProps) {
  const { config, update } = useConfigStore();
  const [showPicker, setShowPicker] = useState(false);

  const addCustom = async () => {
    const newProvider: ProviderConfig = {
      displayName: "",
      baseUrl: "",
      models: [],
    };
    const idx = config.providers.length;
    const next = { ...config, providers: [...config.providers, newProvider] };
    useConfigStore.setState({ config: next });
    onSelect(idx);
    setShowPicker(false);
    try {
      await update(next);
    } catch {
    }
  };

  const addTemplate = async (template: typeof pickerItems[0]) => {
    const idx = config.providers.length;
    const next = { ...config, providers: [...config.providers, { ...template.provider }] };
    useConfigStore.setState({ config: next });
    onSelect(idx);
    setShowPicker(false);
    try {
      await update(next);
    } catch {
      return;
    }
    if (!template.provider.test) {
      fetchProviderModels(idx).then((result) => {
        if (result.models?.length) {
          const providers = [...useConfigStore.getState().config.providers];
          if (!providers[idx]) return;
          providers[idx] = { ...providers[idx], models: result.models };
          useConfigStore.getState().update({ ...useConfigStore.getState().config, providers });
        }
      }).catch((err) => {
        const name = config.providers[idx]?.displayName ?? `Provider ${idx}`;
        console.warn(`[${name}] auto-fetch models failed:`, err instanceof Error ? err.message : err);
      });
    }
  };

  const templateNames = pickerItems.map((t) => t.name);

  const isTemplate = (name: string) => templateNames.includes(name);

  const templateAlreadyAdded = (name: string) =>
    config.providers.some((p) => p.displayName === name);

  const toggleProvider = (index: number) => {
    const providers = [...config.providers];
    providers[index] = { ...providers[index], enabled: !(providers[index].enabled ?? true) };
    update({ ...config, providers });
  };

  const allEnabled = config.providers.every((p) => p.enabled ?? true);

  const toggleAll = () => {
    const providers = config.providers.map((p) => ({ ...p, enabled: !allEnabled }));
    update({ ...config, providers });
  };

  const removeProvider = (index: number) => {
    const providers = config.providers.filter((_, i) => i !== index);
    update({ ...config, providers });
    if (selectedIndex === index) onSelect(-1);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Providers</h3>
        <div className="flex items-center gap-1">
          <button onClick={toggleAll} className="text-xs text-zinc-500 hover:text-zinc-300 px-1" title={allEnabled ? "Disable all" : "Enable all"}>
            {allEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
          <button onClick={() => setShowPicker(!showPicker)} className="p-1 hover:bg-zinc-800 rounded">
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {config.providers.map((provider, i) => {
          const isTpl = isTemplate(provider.displayName);
          const enabled = provider.enabled ?? true;
          return (
            <div
              key={i}
              className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors ${
                selectedIndex === i
                  ? isTpl ? "bg-amber-900/40" : "bg-zinc-700"
                  : "hover:bg-zinc-800"
              } ${enabled ? "" : "opacity-50"}`}
              onClick={() => onSelect(i)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isTpl && <Sparkles size={14} className="text-amber-400 shrink-0" />}
                <span className={`text-sm truncate ${provider.displayName ? "" : "text-zinc-500 italic"}`}>
                  {provider.displayName || "Untitled provider"}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleProvider(i); }}
                  className={`p-0.5 rounded ${enabled ? "text-green-400" : "text-zinc-600"}`}
                >
                  {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeProvider(i); }}
                  className="p-1 hover:bg-zinc-600 rounded opacity-50 hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setShowPicker(false)}>
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl w-64 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-zinc-400 px-3 pt-2 pb-1">Pre-configured</p>
            {pickerItems.map((t, i) => {
              const alreadyAdded = templateAlreadyAdded(t.name);
              return (
                <button
                  key={i}
                  onClick={() => !alreadyAdded && addTemplate(t)}
                  disabled={alreadyAdded}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    alreadyAdded
                      ? "text-zinc-600 cursor-not-allowed"
                      : "hover:bg-zinc-700"
                  }`}
                >
                  <Sparkles size={14} className={alreadyAdded ? "text-zinc-600" : "text-amber-400"} />
                  {t.name}
                  {alreadyAdded && <span className="text-xs ml-auto">Added</span>}
                </button>
              );
            })}
            <div className="border-t border-zinc-700 my-1" />
            <button
              onClick={addCustom}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 flex items-center gap-2 transition-colors"
            >
              <Wrench size={14} className="text-zinc-400" />
              Custom Provider
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
