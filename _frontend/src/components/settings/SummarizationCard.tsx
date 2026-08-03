import { useEffect, useMemo, useState } from "react";
import { Plus, FileText, X, AlertTriangle, Search, Filter, FlaskConical } from "lucide-react";
import { ModelDropdown } from "../chat/ModelDropdown";
import { getMdsScopePaths, type ScopeItem } from "../../lib/api";
import { useSessionStore } from "../../stores/sessions";
import type { PlanScope } from "../../features/info-panel/types";
import { SummarizationTestModal } from "./SummarizationTestModal";

interface SummarizationCardProps {
  sessionId?: string;
  workspaceRoot?: string;
  model?: string;
  fallbackModel?: string;
  promptMd?: string;
  onModel: (model: string | null) => void;
  onFallbackModel: (model: string | null) => void;
  onPromptMd: (path: string | null) => void;
}

export function SummarizationCard({
  sessionId,
  workspaceRoot,
  model,
  fallbackModel,
  promptMd,
  onModel,
  onFallbackModel,
  onPromptMd,
}: SummarizationCardProps) {
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showFallback, setShowFallback] = useState(!!fallbackModel);
  const [showTest, setShowTest] = useState(false);
  const [scopeItems, setScopeItems] = useState<ScopeItem[]>([]);
  const scopeIndex = useMemo(() => {
    const idx: Record<string, boolean> = {};
    for (const item of scopeItems) {
      idx[item.promptPath] = true;
    }
    return idx;
  }, [scopeItems]);

  const activeSessionId = useSessionStore((s) => s.activeId ?? s.sessions[0]?.id);
  const effSession = sessionId ?? activeSessionId;

  useEffect(() => {
    if (!effSession) return;
    let cancelled = false;
    getMdsScopePaths({ sessionId: effSession, workspaceRoot })
      .then((result) => {
        if (cancelled) return;
        const all: ScopeItem[] = [];
        for (const [, scope] of Object.entries(result.scopes) as [PlanScope, { available: boolean; items: ScopeItem[] }][]) {
          if (scope.available) all.push(...scope.items);
        }
        setScopeItems(all);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [effSession, workspaceRoot]);

  // Auto-correct stale promptMd path after MDS DnD (item moved → path no longer valid)
  useEffect(() => {
    if (!promptMd || scopeItems.length === 0 || scopeIndex[promptMd]) return;
    const segments = promptMd.split("/").filter(Boolean);
    if (segments.length < 2) return;
    const last = segments[segments.length - 1];
    const name = last.endsWith(".md") ? last.slice(0, -3) : segments[segments.length - 2];
    if (!name) return;
    const match = scopeItems.find((i) => i.relPath === name || i.relPath.endsWith("/" + name));
    if (match && match.promptPath !== promptMd) {
      onPromptMd(match.promptPath);
    }
  }, [scopeItems]);

  const allTags = useMemo(
    () => [...new Set(scopeItems.flatMap((i) => i.tags))].sort(),
    [scopeItems],
  );

  const q = promptSearch.trim().toLowerCase();
  const filtered = scopeItems.filter((i) => {
    if (q && !i.relPath.toLowerCase().includes(q) && !i.tags.join(" ").toLowerCase().includes(q)) return false;
    if (activeTags.length > 0 && !activeTags.every((t) => i.tags.includes(t))) return false;
    return true;
  });

  const applyTags = (text: string) => {
    const tags = text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setActiveTags((prev) => [...new Set([...prev, ...tags])]);
    setTagInput("");
  };

  const attachPrompt = (path: string) => {
    onPromptMd(path);
    setShowPromptPicker(false);
    setPromptSearch("");
    setActiveTags([]);
    setTagInput("");
  };

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="text-sm font-medium text-zinc-100 mb-1">Summarization</h3>
      <p className="text-xs text-zinc-500 mb-3">
        Optionally pick a model used to summarize old turns for context, and a fallback model
        in case the primary is unavailable.
      </p>

      <div className="mb-3">
        <button
          onClick={() => setShowTest(true)}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
          title="Preview how a summary would turn out with these settings"
        >
          <FlaskConical className="h-3 w-3" />
          Test summarization
        </button>
      </div>

      <div className="space-y-3">
        {/* Primary model selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 w-24">Model</span>
          <ModelDropdown
            providerName={model ? model.split("/")[0] ?? "" : ""}
            modelName={model ? model.split("/").slice(1).join("/") || model : ""}
            onSelect={(provider, m) => onModel(`${provider}/${m}`)}
            triggerClassName="w-full justify-between"
          />
          {model && (
            <button
              onClick={() => onModel(null)}
              className="shrink-0 p-1 text-zinc-500 hover:text-red-400"
              title="Clear model"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Fallback model selector */}
        {showFallback ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 w-24">Fallback</span>
            <ModelDropdown
              providerName={fallbackModel ? fallbackModel.split("/")[0] ?? "" : ""}
              modelName={fallbackModel ? fallbackModel.split("/").slice(1).join("/") || fallbackModel : ""}
              onSelect={(provider, m) => { onFallbackModel(`${provider}/${m}`); setShowFallback(false); }}
              triggerClassName="w-full justify-between"
            />
            <button
              onClick={() => { onFallbackModel(null); setShowFallback(false); }}
              className="shrink-0 p-1 text-zinc-500 hover:text-red-400"
              title="Remove fallback"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 w-24">Fallback</span>
            <button
              onClick={() => setShowFallback(true)}
              className="flex items-center gap-1.5 rounded border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200 hover:border-zinc-500"
              title="Add a fallback model to use if the primary fails"
            >
              <Plus className="h-3 w-3" />
              Add fallback model
            </button>
          </div>
        )}

        {/* Summarization prompt MD */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {promptMd ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">Summarization prompt</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {promptMd ?? "No prompt file attached — uses the default summary prompt"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {promptMd && (
                <button
                  onClick={() => onPromptMd(null)}
                  className="p-1 text-zinc-500 hover:text-red-400"
                  title="Remove prompt file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setShowPromptPicker((v) => !v)}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              >
                {promptMd ? "Change" : "Attach MD"}
              </button>
            </div>
          </div>

          {showPromptPicker && (
            <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 space-y-2">
              <div className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1">
                <Search size={12} className="text-zinc-500 shrink-0" />
                <input
                  type="text"
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  placeholder="Search prompt files..."
                  className="bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none w-full"
                />
                <button
                  onClick={() => setShowTagFilter((v) => !v)}
                  className={`shrink-0 p-0.5 rounded transition-colors ${activeTags.length > 0 ? "text-blue-400" : "text-zinc-500 hover:text-zinc-300"}`}
                  title={activeTags.length > 0 ? `Filtering by ${activeTags.join(", ")}` : "Filter by tags"}
                >
                  <Filter size={13} />
                </button>
              </div>

              {showTagFilter && (
                <div className="space-y-2">
                  {/* Active tag chips (removable) */}
                  {activeTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {activeTags.map((t) => (
                        <span key={t} className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-blue-300">
                          {t}
                          <button
                            onClick={() => setActiveTags((prev) => prev.filter((x) => x !== t))}
                            className="text-blue-400 hover:text-red-400"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={() => setActiveTags([])}
                        className="rounded-full px-2 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
                      >
                        Clear all
                      </button>
                    </div>
                  )}

                  {/* Tag selector from existing MD tags */}
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {allTags.map((t) => (
                        <button
                          key={t}
                          onClick={() =>
                            setActiveTags((prev) =>
                              prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                            )
                          }
                          className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                            activeTags.includes(t)
                              ? "bg-blue-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Comma-separated tag entry */}
                  <div className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyTags(tagInput);
                        } else if (e.key === ",") {
                          applyTags(tagInput);
                        }
                      }}
                      placeholder="Add custom tags, comma separated…"
                      className="bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none w-full"
                    />
                    <button
                      onClick={() => applyTags(tagInput)}
                      className="shrink-0 text-zinc-400 hover:text-zinc-200"
                      title="Add tags"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              )}

              <div className="max-h-40 overflow-y-auto space-y-1">
                {filtered.length === 0 ? (
                  <p className="text-xs text-zinc-500">No markdown files match</p>
                ) : (
                  filtered.map((i) => (
                    <button
                      key={i.promptPath}
                      onClick={() => attachPrompt(i.promptPath)}
                      className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <span className="block truncate">{i.relPath}</span>
                      {i.tags.length > 0 && (
                        <span className="block text-[10px] text-zinc-600">
                          {i.tags.join(", ")}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showTest && (
        <SummarizationTestModal
          sessionId={sessionId}
          workspaceRoot={workspaceRoot}
          model={model}
          fallbackModel={fallbackModel}
          promptMd={promptMd}
          onClose={() => setShowTest(false)}
        />
      )}
    </div>
  );
}
