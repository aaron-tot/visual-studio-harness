import { useState, useEffect } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import { fetchProviderModels } from "../../lib/api";

interface ProviderEditorProps {
  providerIndex: number;
}

export function ProviderEditor({ providerIndex }: ProviderEditorProps) {
  const { config, update } = useConfigStore();
  const provider = config.providers[providerIndex];

  const [displayName, setDisplayName] = useState(provider?.displayName || "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || "");
  const [apiKey, setApiKey] = useState(provider?.apiKey || "");
  const [status, setStatus] = useState<"idle" | "connecting" | "success" | "error">("idle");

  useEffect(() => {
    if (provider) {
      setDisplayName(provider.displayName);
      setBaseUrl(provider.baseUrl);
      setApiKey(provider.apiKey || "");
    }
  }, [provider]);

  if (!provider) return null;

  const save = () => {
    const providers = [...config.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      displayName,
      baseUrl,
      apiKey: apiKey || undefined,
    };
    update({ ...config, providers });
  };

  const saveAndConnect = async () => {
    setStatus("connecting");
    save();

    // Test providers are mock — skip connection check
    if (provider.test) {
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      return;
    }

    try {
      const result = await fetchProviderModels(providerIndex);
      if (result.models?.length) {
        const p = [...useConfigStore.getState().config.providers];
        p[providerIndex] = { ...p[providerIndex], models: result.models };
        update({ ...useConfigStore.getState().config, providers: p });
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Edit Provider</h3>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Display Name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={save}
          placeholder="e.g. Local llama.cpp"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Base URL</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={save}
          placeholder="https://api.example.com/v1"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">API Key (optional)</label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={save}
          type="password"
          placeholder="Optional"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm"
        />
      </div>

      <button
        onClick={saveAndConnect}
        disabled={status === "connecting" || !baseUrl.trim()}
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
    </div>
  );
}
