import { useState, useEffect, useMemo } from "react";
import { Sparkles, RefreshCw, Check, X, Loader2, ToggleLeft, ToggleRight, Circle, Search } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import { fetchProviderModels } from "../../lib/api";
import { getDescriptorByDisplayName } from "../../../../_shared/provider-registry";
import type { FieldDescriptor, AuthType } from "../../../../_shared/provider-registry";

interface TemplateProviderEditorProps {
  providerIndex: number;
}

export function TemplateProviderEditor({ providerIndex }: TemplateProviderEditorProps) {
  const { config, update } = useConfigStore();
  const provider = config.providers[providerIndex];
  const descriptor = getDescriptorByDisplayName(provider?.displayName || "");

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
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

  useEffect(() => {
    if (provider) {
      const values: Record<string, string> = {};
      if (descriptor?.extraFields) {
        for (const field of descriptor.extraFields) {
          values[field.key] = (provider as any)[field.key] || "";
        }
      }
      setFieldValues(values);
    }
  }, [provider, descriptor]);

  if (!provider || !descriptor) return null;

  const mergeModels = (newModels: any[], existing: any[]) => {
    const existingEnabled = new Map(existing.map((m) => [m.modelName, m.enabled]));
    return newModels.map((m) => ({
      ...m,
      enabled: existingEnabled.has(m.modelName) ? existingEnabled.get(m.modelName) : true,
    }));
  };

  const saveAndConnect = async () => {
    setStatus("connecting");
    setErrorMsg(null);
    const providers = [...config.providers];
    const merged: Record<string, any> = {
      baseUrl: descriptor.baseUrl,
    };
    for (const field of descriptor.extraFields || []) {
      merged[field.key] = fieldValues[field.key] || undefined;
    }
    providers[providerIndex] = {
      ...providers[providerIndex],
      ...merged,
    };
    await update({ ...config, providers });

    if (descriptor.editorComponent === "test") {
      setServerReachable(true);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      return;
    }

    try {
      const result = await fetchProviderModels(providerIndex);
      if (result.models?.length) {
        const updatedProviders = [...useConfigStore.getState().config.providers];
        updatedProviders[providerIndex] = {
          ...updatedProviders[providerIndex],
          models: mergeModels(result.models, updatedProviders[providerIndex]?.models || []),
        };
        await update({ ...useConfigStore.getState().config, providers: updatedProviders });
        setStatus("success");
        setServerReachable(true);
      } else {
        setStatus("error");
        setErrorMsg("No models returned from provider");
        setServerReachable(false);
      }
    } catch (err) {
      setStatus("error");
      setServerReachable(false);
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
    }
    setTimeout(() => setStatus("idle"), 5000);
  };

  const renderFields = () => {
    if (!descriptor.extraFields?.length) return null;
    return descriptor.extraFields.map((field) => (
      <div key={field.key} className="space-y-2">
        <label className="text-xs text-zinc-400">{field.label}</label>
        <input
          value={fieldValues[field.key] || ""}
          onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
          type={field.type}
          placeholder={field.placeholder}
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm"
        />
      </div>
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-amber-400" />
        <h3 className="text-base font-medium">{provider.displayName}</h3>
        {serverReachable === true && (
          <Circle size={10} className="fill-green-400 text-green-400 shrink-0" title="Server running" />
        )}
        {serverReachable === false && (
          <Circle size={10} className="fill-red-500 text-red-500 shrink-0" title="Server unreachable" />
        )}
      </div>

      {renderFields()}

      <button
        onClick={saveAndConnect}
        disabled={status === "connecting"}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-all ${
          status === "success"
            ? "bg-green-600 text-white"
            : status === "error"
              ? "bg-red-600 text-white"
              : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
        }`}
      >
        {status === "connecting" ? (
          <><Loader2 size={14} className="animate-spin" /> Connecting...</>
        ) : status === "success" ? (
          <><Check size={14} /> Connected</>
        ) : status === "error" ? (
          <><X size={14} /> Connection failed</>
        ) : (
          "Save & Connect"
        )}
      </button>

      {errorMsg && (
        <p className="text-xs text-red-400 break-words whitespace-pre-wrap">{errorMsg}</p>
      )}

      <p className="text-[11px] text-zinc-500">
        API base: <code className="text-zinc-400">{provider.baseUrl || "—"}</code>
      </p>

      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-400">Models {descriptor.editorComponent === "test" ? "" : "(from API)"}</label>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const allOn = provider.models.every((m) => m.enabled ?? true);
                  const p = [...config.providers];
                  p[providerIndex] = { ...p[providerIndex], models: p[providerIndex].models.map((m) => ({ ...m, enabled: !allOn })) };
                  update({ ...config, providers: p });
                }}
                className="p-1 hover:bg-zinc-800 rounded"
                title="Toggle all models"
              >
                {provider.models.every((m) => m.enabled ?? true) ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              </button>
              {descriptor.editorComponent !== "test" && (
              <button onClick={async () => { setFetching(true); setErrorMsg(null); try { const r = await fetchProviderModels(providerIndex); if (r.models?.length) { const p = [...config.providers]; p[providerIndex] = { ...p[providerIndex], models: mergeModels(r.models, p[providerIndex]?.models || []) }; update({ ...config, providers: p }); setServerReachable(true); } else { setServerReachable(false); setErrorMsg("No models returned from provider"); } } catch (err) { setServerReachable(false); setErrorMsg(err instanceof Error ? err.message : "Connection failed"); } finally { setFetching(false); } }} disabled={fetching} className="p-1 hover:bg-zinc-800 rounded disabled:opacity-50" title="Refresh models">
                <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
              </button>
              )}
            </div>
          </div>
          {provider.models.length > 0 && (
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
          {filteredModels.length === 0 && provider.models.length > 0 ? (
            <p className="text-xs text-zinc-500 px-1">No models match "{searchQuery}"</p>
          ) : (
            <div className="space-y-1">
            {filteredModels.map((entry) => {
              const m = entry.model;
              const i = entry.index;
              const enabled = m.enabled ?? true;
              return (
                <div key={i} className={`flex items-center justify-between px-3 py-1.5 bg-zinc-800 rounded text-sm text-zinc-300 ${enabled ? "" : "opacity-50"}`}>
                  <span className="flex items-center gap-2">
                    {m.isLoaded === true && <Circle size={8} className="fill-green-400 text-green-400 shrink-0" title="Loaded" />}
                    {m.isLoaded === false && <Circle size={8} className="fill-red-500 text-red-500 shrink-0" title="Not loaded" />}
                    {m.displayName}
                  </span>
                  <button
                    onClick={() => {
                      const p = [...config.providers];
                      p[providerIndex] = {
                        ...p[providerIndex],
                        models: p[providerIndex].models.map((mm, j) =>
                          j === i ? { ...mm, enabled: !enabled } : mm
                        ),
                      };
                      update({ ...config, providers: p });
                    }}
                    className={`p-0.5 rounded ${enabled ? "text-green-400" : "text-zinc-600"}`}
                  >
                    {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
  </div>
  );
}
