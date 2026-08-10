import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/config";
import type { ConfigFile, SearchProviderConfig, SearchProviderType } from "../../../../_shared/types";
import { getConfig, updateConfig as apiUpdateConfig } from "../../lib/api";

const PROVIDER_TYPES: { value: SearchProviderType; label: string; description: string }[] = [
  { value: "exa", label: "Exa", description: "High-quality web search with AI summaries" },
  { value: "parallel", label: "Parallel", description: "Fast parallel web search" },
  { value: "brave", label: "Brave Search", description: "Privacy-focused search engine" },
  { value: "serper", label: "Serper", description: "Google search API via Serper.dev" },
  { value: "custom", label: "Custom MCP", description: "Custom MCP endpoint with authentication" },
];

const DEFAULT_PRIORITY_TAGS: Record<number, string[]> = {
  0: ["primary", "batch-rotate"],
  1: ["fallback", "batch-rotate"],
  2: ["fallback", "batch-rotate"],
  3: ["fallback"],
};

interface TestResult {
  success: boolean;
  provider: string;
  result?: string;
  error?: string;
}

export function SearchProvidersPanel() {
  const { config, update } = useConfigStore();
  const [localProviders, setLocalProviders] = useState<SearchProviderConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProviderForm, setNewProviderForm] = useState<Partial<SearchProviderConfig>>({
    type: "exa",
    name: "",
    enabled: true,
    priority: 0,
    apiKey: "",
    tags: [],
    customMcpUrl: "",
    description: "",
  });
  const [rateLimits, setRateLimits] = useState<Record<string, { rpm?: number; rpd?: number }>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  // Initialize from config
  useEffect(() => {
    const providers = config.searchProviders ?? [];
    setLocalProviders([...providers].sort((a, b) => a.priority - b.priority));
    const rl: Record<string, { rpm?: number; rpd?: number }> = {};
    for (const p of providers) {
      if (p.rateLimit) rl[p.id] = p.rateLimit;
    }
    setRateLimits(rl);
  }, [config.searchProviders]);

  // Sync to config store
  const saveProviders = async (providers: SearchProviderConfig[]) => {
    const sorted = [...providers].sort((a, b) => a.priority - b.priority);
    setLocalProviders(sorted);
    await update({ ...config, searchProviders: sorted });
  };

  const handleTestProvider = async (provider: SearchProviderConfig) => {
    setTestingId(provider.id);
    // Clear previous result, don't show fake failure
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider.id];
      return next;
    });

    try {
      const res = await fetch("/api/search-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
      });

      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [provider.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResults((prev) => ({ ...prev, [provider.id]: { success: false, provider: provider.name, error: msg } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleAddProvider = async () => {
    if (!newProviderForm.name || !newProviderForm.type) return;

    const maxPriority = Math.max(...localProviders.map(p => p.priority), -1);
    const tags = DEFAULT_PRIORITY_TAGS[maxPriority + 1] ?? ["fallback"];

    const newProvider: SearchProviderConfig = {
      id: `${newProviderForm.type}-${Date.now()}`,
      type: newProviderForm.type,
      name: newProviderForm.name,
      enabled: newProviderForm.enabled ?? true,
      priority: maxPriority + 1,
      apiKey: newProviderForm.apiKey || undefined,
      rateLimit: newProviderForm.type === "custom" ? undefined : rateLimits[newProviderForm.id ?? ""],
      tags,
      customMcpUrl: newProviderForm.type === "custom" ? newProviderForm.customMcpUrl : undefined,
      description: newProviderForm.description || undefined,
    };

    await saveProviders([...localProviders, newProvider]);
    setShowAddModal(false);
    setNewProviderForm({ type: "exa", name: "", enabled: true, priority: 0, apiKey: "", tags: [], customMcpUrl: "", description: "" });
  };

  const handleUpdateProvider = async (id: string, patch: Partial<SearchProviderConfig>) => {
    const updated = localProviders.map(p =>
      p.id === id ? { ...p, ...patch } : p
    );
    await saveProviders(updated);
  };

  const handleDeleteProvider = async (id: string) => {
    if (localProviders.length <= 1) return; // Keep at least one
    const updated = localProviders.filter(p => p.id !== id);
    await saveProviders(updated);
  };

  const handleReorder = async (fromId: string, toId: string) => {
    const fromIdx = localProviders.findIndex(p => p.id === fromId);
    const toIdx = localProviders.findIndex(p => p.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const updated = [...localProviders];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);

    // Reassign priorities based on new order
    const withPriorities = updated.map((p, i) => ({ ...p, priority: i }));
    await saveProviders(withPriorities);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId && sourceId !== targetId) {
      handleReorder(sourceId, targetId);
    }
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDragOverId(null);
  };

  const getProviderTypeInfo = (type: SearchProviderType) => {
    return PROVIDER_TYPES.find(t => t.value === type) ?? PROVIDER_TYPES[0];
  };

  const isPrimary = (p: SearchProviderConfig) => p.priority === 0 && p.enabled;
  const isInBatchRotation = (p: SearchProviderConfig) => p.tags?.includes("batch-rotate") ?? false;
  const isBuiltIn = (p: SearchProviderConfig) => BUILTIN_PROVIDER_IDS.has(p.id);

  return (
    <div className="space-y-6">
      {/* Primary Provider Selection */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-medium text-zinc-100">Primary Provider</h3>
        <p className="text-xs text-zinc-500">
          Used for single search calls. Fallbacks are tried in order if this provider hits rate limits.
        </p>
        <div className="space-y-2">
          {localProviders.filter(p => p.enabled).map((provider) => (
            <label key={provider.id} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="primary-provider"
                checked={isPrimary(provider)}
                onChange={() => handleUpdateProvider(provider.id, {
                  priority: 0,
                  tags: ["primary", "batch-rotate"],
                })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm text-zinc-200 group-hover:text-zinc-100">
                  <span className="capitalize">{getProviderTypeInfo(provider.type).label}</span>
                  <span className="text-xs text-zinc-500">|</span>
                  <span>{provider.name}</span>
                  {isInBatchRotation(provider) && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">batch</span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Priority: {provider.priority} {provider.apiKey ? "• API key configured" : "• No API key (using env)"}
                </div>
                {provider.description && (
                  <div className="text-[10px] text-zinc-400 italic mt-0.5">
                    {provider.description}
                  </div>
                )}
                {(!provider.description && (provider.id === "exa-primary" || provider.id === "parallel-backup")) && (
                  <div className="text-[10px] text-zinc-400 italic mt-0.5">
                    {provider.id === "exa-primary"
                      ? "Exa MCP — keyless works but rate-limited. Set EXA_API_KEY for higher limits."
                      : "Parallel Search MCP — free/keyless by default. Set PARALLEL_API_KEY for higher limits."}
                  </div>
                )}
              </div>
            </label>
          ))}
          {localProviders.filter(p => p.enabled).length === 0 && (
            <p className="text-sm text-zinc-500">No enabled providers. Add one below.</p>
          )}
        </div>
      </div>

      {/* Fallback Chain */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-100">Fallback Chain</h3>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            + Add Provider
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Drag to reorder. Tried sequentially when primary hits rate limits. Disabled providers are skipped.
        </p>

        <div className="space-y-2">
          {localProviders.map((provider, index) => {
            const result = testResults[provider.id];
            const isTesting = testingId === provider.id;
            return (
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${
                  provider.enabled ? "border-zinc-800 bg-zinc-900" : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
                } ${dragOverId === provider.id ? "border-blue-500 bg-blue-500/10" : ""}`}>
                  <span className="text-xs text-zinc-500 font-mono w-6 text-center">{provider.priority}</span>
                  <span className="text-[10px] text-zinc-400">⋮⋮</span>

                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(e) => handleUpdateProvider(provider.id, { enabled: e.target.checked })}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                    title={provider.enabled ? "Enabled" : "Disabled"}
                  />

                  <select
                    value={provider.type}
                    onChange={(e) => handleUpdateProvider(provider.id, { type: e.target.value as SearchProviderType })}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 w-36"
                    disabled={editingId === provider.id}
                  >
                    {PROVIDER_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={provider.name}
                    onChange={(e) => handleUpdateProvider(provider.id, { name: e.target.value })}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 w-32"
                    placeholder="Name"
                  />

                  {provider.description && (
                    <div className="text-[10px] text-zinc-400 italic mt-0.5">
                      {provider.description}
                    </div>
                  )}
                  {(!provider.description && (provider.id === "exa-primary" || provider.id === "parallel-backup")) && (
                    <div className="text-[10px] text-zinc-400 italic mt-0.5">
                      {provider.id === "exa-primary"
                        ? "Exa MCP — keyless works but rate-limited. Set EXA_API_KEY for higher limits."
                        : "Parallel Search MCP — free/keyless by default. Set PARALLEL_API_KEY for higher limits."}
                    </div>
                  )}

                {provider.type === "custom" && (
                  <input
                    type="text"
                    value={provider.customMcpUrl ?? ""}
                    onChange={(e) => handleUpdateProvider(provider.id, { customMcpUrl: e.target.value })}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 flex-1 min-w-0"
                    placeholder="MCP endpoint URL"
                  />
                )}

                <input
                  type="password"
                  value={provider.apiKey ?? ""}
                  onChange={(e) => handleUpdateProvider(provider.id, { apiKey: e.target.value || undefined })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 w-32"
                  placeholder="API Key"
                  title={provider.apiKey ? "Configured (click to change)" : "Optional: overrides env var"}
                />

                <label className="flex items-center gap-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={isInBatchRotation(provider)}
                    onChange={(e) => handleUpdateProvider(provider.id, {
                      tags: e.target.checked
                        ? [...(provider.tags ?? []), "batch-rotate"]
                        : (provider.tags ?? []).filter(t => t !== "batch-rotate"),
                    })}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs text-zinc-400 group-hover:text-zinc-200">Batch rotate</span>
                </label>

                {provider.rateLimit?.rpm && (
                  <span className="text-[10px] text-zinc-500 px-2 py-0.5 bg-zinc-800 rounded">
                    {provider.rateLimit.rpm} rpm
                  </span>
                )}

                {/* Test Button */}
                <button
                  type="button"
                  onClick={() => handleTestProvider(provider)}
                  disabled={!provider.enabled || isTesting}
                  className={`p-1.5 rounded transition-colors ${
                    isTesting
                      ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-green-400"
                  }`}
                  title={isTesting ? "Testing..." : "Test this provider"}
                >
                  {isTesting ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                </button>

                {/* Test Result Indicator */}
                {(result || isTesting) && (
                  <span
                    className={`px-2 py-0.5 text-[10px] rounded ${
                      isTesting
                        ? "bg-blue-500/20 text-blue-400"
                        : result.success
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                    title={isTesting ? "Testing..." : result.result || result.error}
                  >
                    {isTesting ? (
                      <>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin inline-block mr-1">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
                        </svg>
                        Testing...
                      </>
                    ) : result.success ? (
                      "✓ OK"
                    ) : (
                      "✗ Failed"
                    )}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => handleDeleteProvider(provider.id)}
                  disabled={localProviders.length <= 1}
                  className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed p-1"
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {localProviders.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-4">No providers configured. Click "Add Provider" to start.</p>
        )}
      </div>

      {/* Batch Rotation Settings */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-zinc-100">Batch Rotation</h3>
        <p className="text-xs text-zinc-500">
          When multiple search calls happen in one turn, rotate through checked providers to distribute load.
        </p>
        <div className="flex flex-wrap gap-3">
          {localProviders.filter(p => p.enabled).map(provider => (
            <label key={provider.id} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={isInBatchRotation(provider)}
                onChange={(e) => handleUpdateProvider(provider.id, {
                  tags: e.target.checked
                    ? [...(provider.tags ?? []), "batch-rotate"]
                    : (provider.tags ?? []).filter(t => t !== "batch-rotate"),
                })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-zinc-300 group-hover:text-zinc-100">
                {getProviderTypeInfo(provider.type).label} - {provider.name}
              </span>
            </label>
          ))}
        </div>
        {localProviders.filter(p => p.enabled && isInBatchRotation(p)).length === 0 && (
          <p className="text-xs text-zinc-500">No providers selected for batch rotation.</p>
        )}
      </div>

      {/* Rate Limit Configuration */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-zinc-100">Rate Limits (Optional)</h3>
        <p className="text-xs text-zinc-500">
          Proactive throttling. Set requests per minute (RPM) per provider. Empty = no local limit.
        </p>
        <div className="space-y-2">
          {localProviders.map(provider => (
            <div key={provider.id} className="flex items-center gap-3">
              <span className="text-xs text-zinc-400 w-24">{getProviderTypeInfo(provider.type).label}</span>
              <span className="text-xs text-zinc-300 w-32">{provider.name}</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={provider.rateLimit?.rpm ?? ""}
                onChange={(e) => handleUpdateProvider(provider.id, {
                  rateLimit: { ...provider.rateLimit, rpm: e.target.value ? Number(e.target.value) : undefined },
                })}
                placeholder="RPM"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
              />
              <input
                type="number"
                min={1}
                max={100000}
                value={provider.rateLimit?.rpd ?? ""}
                onChange={(e) => handleUpdateProvider(provider.id, {
                  rateLimit: { ...provider.rateLimit, rpd: e.target.value ? Number(e.target.value) : undefined },
                })}
                placeholder="RPD"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
              />
              <span className="text-[10px] text-zinc-500">req/min • req/day</span>
            </div>
          ))}
        </div>
      </div>

      {/* Add Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-zinc-100">Add Search Provider</h3>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Type</label>
              <select
                value={newProviderForm.type}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, type: e.target.value as SearchProviderType })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
              >
                {PROVIDER_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Name</label>
              <input
                type="text"
                value={newProviderForm.name}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, name: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                placeholder="e.g., Exa Primary, Parallel Backup"
              />
            </div>

            {newProviderForm.type === "custom" && (
              <div className="space-y-2">
                <label className="text-xs text-zinc-400">MCP Endpoint URL</label>
                <input
                  type="text"
                  value={newProviderForm.customMcpUrl}
                  onChange={(e) => setNewProviderForm({ ...newProviderForm, customMcpUrl: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                  placeholder="https://your-mcp-server.com/mcp"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">API Key (optional)</label>
              <input
                type="password"
                value={newProviderForm.apiKey}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, apiKey: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                placeholder="Leave empty to use environment variable"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Description (optional)</label>
              <input
                type="text"
                value={newProviderForm.description ?? ""}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, description: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                placeholder="e.g., keyless but rate-limited; add API key for higher limits"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newProviderForm.enabled ?? true}
                onChange={(e) => setNewProviderForm({ ...newProviderForm, enabled: e.target.checked })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-zinc-300">Enabled</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 text-xs border border-zinc-700 rounded hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddProvider}
                disabled={!newProviderForm.name}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
              >
                Add Provider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
