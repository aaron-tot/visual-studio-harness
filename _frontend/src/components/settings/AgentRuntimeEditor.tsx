import { useState, useEffect } from "react";
import { FileText, Edit3, Plus, AlertTriangle, Undo2 } from "lucide-react";
import type {
  AgentSettings,
  AgentMdConfig,
  SkillMdConfig,
  ThinkingEffort,
} from "../../../../_shared/types";

const ATTACHMENT_MODES: { value: "inject" | "hard" | "soft"; label: string; desc: string }[] = [
  { value: "inject", label: "Inject", desc: "Embed in system prompt" },
  { value: "hard", label: "Hard", desc: "Must read before tasks" },
  { value: "soft", label: "Soft", desc: "Reference — use skill tool" },
];
import { useConfigStore } from "../../stores/config";
import { readMd, getMdsScopePaths, getMdsAgentsPaths, type ScopeItem, type ScopePathEntry } from "../../lib/api";
import type { PlanScope } from "../../features/info-panel/types";
import { MdsEditModal } from "../../features/mds/MdsEditModal";
import { useSessionStore } from "../../stores/sessions";

const EFFORTS: ThinkingEffort[] = ["off", "low", "medium", "high"];

interface AgentRuntimeEditorProps {
  label: string;
  hint?: string;
  value: AgentSettings;
  onChange: (next: AgentSettings) => void;
  agentKey: string;
  onRename?: (newKey: string) => void;
}

export function AgentRuntimeEditor({
  label,
  hint,
  value,
  onChange,
  agentKey,
  onRename,
}: AgentRuntimeEditorProps) {
  const { config } = useConfigStore();
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillPickerTab, setSkillPickerTab] = useState<"discover" | "custom">("discover");
  const [skillPickerAttachmentMode, setSkillPickerAttachmentMode] = useState<"inject" | "hard" | "soft">("inject");
  const [customSkillPath, setCustomSkillPath] = useState("");
  const [showAgentMdPicker, setShowAgentMdPicker] = useState(false);
  const [agentMdPickerTab, setAgentMdPickerTab] = useState<"discover" | "custom">("discover");
  const [customAgentMdPath, setCustomAgentMdPath] = useState("");

  const sessionId = useSessionStore((s) => s.activeId ?? s.sessions[0]?.id);
  const [globalSystemPromptBasePath, setGlobalSystemPromptBasePath] = useState<string | null>(null);
  const [workspaceAgentsMd, setWorkspaceAgentsMd] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [scopeItems, setScopeItems] = useState<ScopeItem[]>([]);
  const [scopeIndex, setScopeIndex] = useState<Record<string, { scope: PlanScope; relPath: string }>>({});
  const [editTarget, setEditTarget] = useState<{ scope: PlanScope; relPath: string; ext: string } | null>(null);
  const [agentMdTagFilter, setAgentMdTagFilter] = useState("");
  const [agentMdSearch, setAgentMdSearch] = useState("");
  const [skillTagFilter, setSkillTagFilter] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [fileErrors, setFileErrors] = useState<Set<string>>(new Set());
  const [showSysPromptBasePicker, setShowSysPromptBasePicker] = useState(false);
  const [sysPromptBaseTab, setSysPromptBaseTab] = useState<"discover" | "custom">("discover");
  const [customSysPromptBasePath, setCustomSysPromptBasePath] = useState("");

  useEffect(() => {
    const paths: string[] = [];
    if (value.agentMd?.path) paths.push(value.agentMd.path);
    for (const s of value.skillMds ?? []) {
      if (s.mode === "custom" && s.path) paths.push(s.path);
    }
    const errors = new Set<string>();
    Promise.all(paths.map(async (p) => {
      try {
        await readMd(sessionId, p);
      } catch {
        errors.add(p);
      }
    })).then(() => setFileErrors(errors));
  }, [value.agentMd, value.skillMds, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    getMdsAgentsPaths(sessionId).then((paths) => {
      setGlobalSystemPromptBasePath(paths.globalBase);
      setWorkspaceAgentsMd(paths.workspaceAgents);
      setWorkspaceRoot(paths.workspaceRoot);
    }).catch(() => {});
  }, [sessionId]);

  // V2 scope items: tags come from each item's own prompt.json (not folder location).
  useEffect(() => {
    let cancelled = false;
    getMdsScopePaths({ sessionId, workspaceRoot: undefined })
      .then((result) => {
        if (cancelled) return;
        const all: ScopeItem[] = [];
        const index: Record<string, { scope: PlanScope; relPath: string }> = {};
        for (const [scopeKey, scope] of Object.entries(result.scopes) as [PlanScope, ScopePathEntry][]) {
          if (scope.available) {
            all.push(...scope.items);
            for (const item of scope.items) {
              index[item.promptPath] = { scope: scopeKey, relPath: item.relPath };
            }
          }
        }
        setScopeItems(all);
        setScopeIndex(index);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Auto-correct stale paths after DnD: when scopeItems refresh, if a path stored in
  // value.agentMd/value.skillMds is no longer found in scopeIndex (item moved via DnD),
  // find the matching item by folder name and update the path.
  useEffect(() => {
    if (scopeItems.length === 0 || Object.keys(scopeIndex).length === 0) return;
    const changes: { type: "agentMd" | "skillMd"; index?: number; newPath: string }[] = [];

    const itemNameFromPath = (p: string): string => {
      const segments = p.split("/").filter(Boolean);
      if (segments.length < 2) return "";
      const last = segments[segments.length - 1];
      // V1 flat filename: "customHello.md" → "customHello"
      if (last.endsWith(".md")) return last.slice(0, -3);
      // V2 folder structure: "customHello/prompt.md" → "customHello"
      return segments[segments.length - 2];
    };

    if (value.agentMd?.path && !scopeIndex[value.agentMd.path]) {
      const name = itemNameFromPath(value.agentMd.path);
      if (name) {
        const match = scopeItems.find((i) => i.relPath === name || i.relPath.endsWith("/" + name));
        if (match) changes.push({ type: "agentMd", newPath: match.promptPath });
      }
    }

    for (let i = 0; i < (value.skillMds ?? []).length; i++) {
      const s = value.skillMds![i];
      if (s.mode === "custom" && s.path && !scopeIndex[s.path]) {
        const name = itemNameFromPath(s.path);
        if (name) {
          const match = scopeItems.find((i) => i.relPath === name || i.relPath.endsWith("/" + name));
          if (match) changes.push({ type: "skillMd", index: i, newPath: match.promptPath });
        }
      }
    }

    if (changes.length > 0) {
      const next: AgentSettings = { ...value };
      for (const c of changes) {
        if (c.type === "agentMd") {
          next.agentMd = { ...next.agentMd!, path: c.newPath };
        } else {
          const skills = [...(next.skillMds ?? [])];
          skills[c.index!] = { ...skills[c.index!], path: c.newPath };
          next.skillMds = skills;
        }
      }
      onChange(next);
    }
  }, [scopeItems]);
  const providers = config.providers.filter((p) => p.enabled !== false);
  const selectedProvider =
    providers.find((p) => p.displayName === value.providerName) ?? providers[0];
  const models = (selectedProvider?.models ?? []).filter((m) => m.enabled !== false);

  const [nameDraft, setNameDraft] = useState(agentKey);

  useEffect(() => {
    setNameDraft(agentKey);
  }, [agentKey]);

  const patch = (partial: Partial<AgentSettings>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div>
        <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const trimmed = nameDraft.trim();
              if (trimmed && trimmed !== agentKey && onRename) {
                onRename(trimmed);
              }
              setNameDraft(agentKey);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setNameDraft(agentKey);
            }}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm font-medium text-zinc-100"
          />
        {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Provider</span>
          <select
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.providerName ?? selectedProvider?.displayName ?? ""}
            onChange={(e) => {
              const p = providers.find((x) => x.displayName === e.target.value);
              const firstModel = p?.models.find((m) => m.enabled !== false);
              patch({
                providerName: e.target.value || undefined,
                modelName: firstModel?.displayName ?? value.modelName,
              });
            }}
          >
            {providers.length === 0 ? (
              <option value="">No providers</option>
            ) : (
              providers.map((p) => (
                <option key={p.displayName} value={p.displayName}>
                  {p.displayName}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Model</span>
          <select
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.modelName ?? models[0]?.displayName ?? ""}
            onChange={(e) => patch({ modelName: e.target.value || undefined })}
          >
            {models.length === 0 ? (
              <option value="">No models</option>
            ) : (
              models.map((m) => (
                <option key={m.displayName} value={m.displayName}>
                  {m.displayName}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Temperature</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            placeholder="default"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.temperature ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                patch({ temperature: undefined });
                return;
              }
              const n = Number(raw);
              if (!Number.isNaN(n)) patch({ temperature: n });
            }}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Thinking</span>
          <select
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.thinking?.effort ?? "off"}
            onChange={(e) =>
              patch({ thinking: { effort: e.target.value as ThinkingEffort } })
            }
          >
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-8 w-10 rounded-md border border-zinc-700 bg-zinc-900 cursor-pointer"
              value={value.color ?? "#3b82f6"}
              onChange={(e) => patch({ color: e.target.value })}
            />
            <input
              type="text"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 font-mono"
              value={value.color ?? ""}
              placeholder="#000000"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                  patch({ color: v || undefined });
                }
              }}
            />
            <button
              onClick={() => patch({ color: undefined })}
              className="whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              Reset
            </button>
          </div>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Max steps</span>
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.maxSteps ?? ""}
            placeholder="default"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                patch({ maxSteps: undefined });
                return;
              }
              const n = parseInt(raw, 10);
              if (!Number.isNaN(n) && n > 0) patch({ maxSteps: n });
            }}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Skill Access</span>
          <select
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.skillAccess ?? "all"}
            onChange={(e) => patch({ skillAccess: e.target.value as "all" | "attached" })}
          >
            <option value="all">All skills in roots</option>
            <option value="attached">Only attached skills</option>
          </select>
        </label>

      </div>

      {/* System Message Files */}
      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <h4 className="text-xs font-medium text-zinc-300">System Messages</h4>
        <p className="text-[11px] text-zinc-500">
          These files are appended together and injected as a single system message.
        </p>
        <p className="text-[11px] text-zinc-500">
          Only one system message combo is sent per context — always the latest version. To save
          tokens, old system messages are stripped as stale and redundant.
        </p>

        {/* Base System Prompt (systemPromptBase.md) — per-agent editable */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">Base System Prompt</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {(() => {
                    const effective = value.systemPromptBase?.path ?? config.systemPromptBase?.path ?? globalSystemPromptBasePath;
                    return effective ?? "Not found";
                  })()}
                  {value.systemPromptBase && " (custom)"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {value.systemPromptBase && (
                <button
                  onClick={() => patch({ systemPromptBase: undefined })}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                  title="Restore default"
                >
                  <Undo2 className="h-3 w-3" />
                  Restore default
                </button>
              )}
              {(() => {
                const effectivePath = value.systemPromptBase?.path ?? config.systemPromptBase?.path ?? globalSystemPromptBasePath;
                if (effectivePath) {
                  return (
                    <button
                      onClick={() => {
                        // Try to find the path in scopeIndex for editing
                        const hit = scopeIndex[effectivePath];
                        if (hit) {
                          setEditTarget({ scope: hit.scope, relPath: hit.relPath, ext: "md" });
                        }
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      <Edit3 className="h-3 w-3" />
                      Edit
                    </button>
                  );
                }
                return null;
              })()}
              <button
                onClick={() => {
                  setShowSysPromptBasePicker(!showSysPromptBasePicker);
                }}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              >
                {value.systemPromptBase ? "Change" : <><Plus className="h-3.5 w-3.5" /> Set</>}
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            The global "constitution" — applies to every agent regardless of session or workspace.
            {value.systemPromptBase ? " This agent uses a custom source." : ""}
          </p>
        </div>

        {/* System prompt base picker */}
        {showSysPromptBasePicker && (
          <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => setSysPromptBaseTab("discover")}
                className={`rounded px-2 py-1 text-xs ${
                  sysPromptBaseTab === "discover"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Discover
              </button>
              <button
                onClick={() => setSysPromptBaseTab("custom")}
                className={`rounded px-2 py-1 text-xs ${
                  sysPromptBaseTab === "custom"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Custom Path
              </button>
            </div>

            {sysPromptBaseTab === "discover" && (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {scopeItems.length === 0 ? (
                  <p className="text-xs text-zinc-500">No scope items found</p>
                ) : (
                  scopeItems.map((i) => (
                    <button
                      key={i.promptPath}
                      onClick={() => {
                        onChange({
                          ...value,
                          systemPromptBase: { mode: "existing", path: i.promptPath },
                        });
                        setShowSysPromptBasePicker(false);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      {i.relPath}
                    </button>
                  ))
                )}
              </div>
            )}

            {sysPromptBaseTab === "custom" && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="/path/to/prompt.md"
                  value={customSysPromptBasePath}
                  onChange={(e) => setCustomSysPromptBasePath(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                />
                <button
                  onClick={() => {
                    if (customSysPromptBasePath.trim()) {
                      onChange({
                        ...value,
                        systemPromptBase: { mode: "existing", path: customSysPromptBasePath.trim() },
                      });
                      setCustomSysPromptBasePath("");
                      setShowSysPromptBasePicker(false);
                    }
                  }}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                >
                  Set
                </button>
              </div>
            )}
          </div>
        )}

        {/* Project AGENTS.md (workspace root) */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">Project AGENTS.md</p>
                {workspaceAgentsMd ? (
                  <p className="truncate text-[11px] text-zinc-500">{workspaceAgentsMd}</p>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    No agents.md / AGENTS.md found in workspace root{workspaceRoot ? ` (${workspaceRoot})` : ""}
                  </p>
                )}
              </div>
            </div>
            {/* AGENTS.md is a separate mechanism (project root, not an MDS scope item) — display only. */}
            {workspaceAgentsMd && (
              <span className="shrink-0 rounded border border-zinc-800 px-1.5 py-1 text-[10px] uppercase tracking-wide text-zinc-600">
                auto-loaded
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Project-level rules from AGENTS.md at the workspace root. Tied to the current
            workspace — a session in a different workspace uses its own AGENTS.md.
          </p>
        </div>
      </div>

      {/* Agent Mode */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-zinc-300">Agent Mode</h4>
            <p className="text-[11px] text-zinc-500">
              Attach one agent MD file to this agent.
            </p>
          </div>
          <button
            onClick={() => {
              setShowSkillPicker(false);
              setShowAgentMdPicker(!showAgentMdPicker);
            }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            {value.agentMd ? "Change" : <><Plus className="h-3.5 w-3.5" /> Add Agent MD</>}
          </button>
        </div>

        {/* Attached agent MD pill */}
        {value.agentMd && (
          <div className="flex flex-wrap gap-1">
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${fileErrors.has(value.agentMd.path ?? "") ? "bg-red-900/50 text-red-300 ring-1 ring-red-500/50" : "bg-zinc-800 text-zinc-300"}`} title={fileErrors.has(value.agentMd.path ?? "") ? `File not found at: ${value.agentMd.path}` : undefined}>
              {fileErrors.has(value.agentMd.path ?? "") && <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />}
              {value.agentMd.path ?? "Inline"}
              {value.agentMd.path && scopeIndex[value.agentMd.path] && (
                <button
                  onClick={() => {
                    const hit = scopeIndex[value.agentMd.path!];
                    setEditTarget({ scope: hit.scope, relPath: hit.relPath, ext: "md" });
                  }}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <Edit3 className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => onChange({ ...value, agentMd: undefined })}
                className="text-zinc-500 hover:text-red-400"
              >
                ×
              </button>
            </span>
          </div>
        )}

        {/* Agent MD picker */}
        {showAgentMdPicker && (
          <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => setAgentMdPickerTab("discover")}
                className={`rounded px-2 py-1 text-xs ${
                  agentMdPickerTab === "discover"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Discover
              </button>
              <button
                onClick={() => setAgentMdPickerTab("custom")}
                className={`rounded px-2 py-1 text-xs ${
                  agentMdPickerTab === "custom"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Custom Path
              </button>
            </div>

            {agentMdPickerTab === "discover" && (
              <div className="space-y-1">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Search by path…"
                    value={agentMdSearch}
                    onChange={(e) => setAgentMdSearch(e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600"
                  />
                  <select
                    value={agentMdTagFilter}
                    onChange={(e) => setAgentMdTagFilter(e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200"
                    title="Filter by tag"
                  >
                    <option value="">All tags</option>
                    {[...new Set(scopeItems.flatMap((i) => i.tags))].sort().map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {(() => {
                    const q = agentMdSearch.trim().toLowerCase();
                    const filtered = scopeItems.filter(
                      (i) =>
                        (!agentMdTagFilter || i.tags.includes(agentMdTagFilter)) &&
                        (!q || i.relPath.toLowerCase().includes(q))
                    );
                    return filtered.length === 0 ? (
                      <p className="text-xs text-zinc-500">No agent Mds match</p>
                    ) : (
                      filtered.map((i) => (
                        <button
                          key={i.promptPath}
                          onClick={() => {
                            onChange({
                              ...value,
                              agentMd: { mode: "existing", path: i.promptPath },
                            });
                            setShowAgentMdPicker(false);
                          }}
                          className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                        >
                          {i.relPath}
                        </button>
                      ))
                    );
                  })()}
                </div>
              </div>
            )}

            {agentMdPickerTab === "custom" && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="/path/to/agent.md"
                  value={customAgentMdPath}
                  onChange={(e) => setCustomAgentMdPath(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                />
                <button
                  onClick={() => {
                    if (customAgentMdPath.trim()) {
                      onChange({
                        ...value,
                        agentMd: { mode: "existing", path: customAgentMdPath.trim() },
                      });
                      setCustomAgentMdPath("");
                      setShowAgentMdPicker(false);
                    }
                  }}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MDS editor modal (V2, scope-based) */}
      {editTarget && (
        <MdsEditModal
          scope={editTarget.scope}
          relPath={editTarget.relPath}
          ext={editTarget.ext}
          sessionId={sessionId}
          workspaceRoot={workspaceRoot || undefined}
          allTags={[...new Set(scopeItems.flatMap((i) => i.tags))]}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            getMdsAgentsPaths(sessionId).then((paths) => {
              setGlobalSystemPromptBasePath(paths.globalBase);
              setWorkspaceAgentsMd(paths.workspaceAgents);
            }).catch(() => {});
          }}
        />
      )}

      {/* Skill MDs Section */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-medium text-zinc-300">Skill MD Files</h4>
            <p className="text-[11px] text-zinc-500">
              All skill files are discoverable by the agent at runtime. Skills you assign here
              are also injected into the system prompt — useful for critical skills you want
              to force the agent to read, but use sparingly to conserve tokens.
            </p>
          </div>
          <button
            onClick={() => {
              setShowAgentMdPicker(false);
              setShowSkillPicker(!showSkillPicker);
            }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Attached skills list */}
        {value.skillMds && value.skillMds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {value.skillMds.map((skill, i) => {
              const skillPath = skill.mode === "custom" ? skill.path : undefined;
              const hasError = skillPath ? fileErrors.has(skillPath) : false;
              const attachmentMode = skill.attachmentMode ?? "inject";
              return (
                <span
                  key={i}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${hasError ? "bg-red-900/50 text-red-300 ring-1 ring-red-500/50" : "bg-zinc-800 text-zinc-300"}`}
                  title={hasError ? `File not found at: ${skillPath}` : undefined}
                >
                  {hasError && <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />}
                  {skill.mode === "existing" ? skill.name ?? "Unnamed" : skill.path ?? "Custom"}
                  <select
                    value={attachmentMode}
                    onChange={(e) => {
                      const newSkillMds = [...(value.skillMds ?? [])];
                      newSkillMds[i] = { ...newSkillMds[i], attachmentMode: e.target.value as "inject" | "hard" | "soft" };
                      onChange({ ...value, skillMds: newSkillMds });
                    }}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-200"
                    title="Attachment mode"
                  >
                    {ATTACHMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value} title={m.desc}>{m.label}</option>
                    ))}
                  </select>
                  {skillPath && scopeIndex[skillPath] && (
                    <button
                      onClick={() => {
                        const hit = scopeIndex[skillPath];
                        setEditTarget({ scope: hit.scope, relPath: hit.relPath, ext: "md" });
                      }}
                      className="text-zinc-500 hover:text-zinc-200"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const newSkillMds = [...(value.skillMds ?? [])];
                      newSkillMds.splice(i, 1);
                      onChange({ ...value, skillMds: newSkillMds });
                    }}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Skill picker */}
        {showSkillPicker && (
          <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => setSkillPickerTab("discover")}
                className={`rounded px-2 py-1 text-xs ${
                  skillPickerTab === "discover"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Discover Skills
              </button>
              <button
                onClick={() => setSkillPickerTab("custom")}
                className={`rounded px-2 py-1 text-xs ${
                  skillPickerTab === "custom"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Custom Path
              </button>
            </div>

            {skillPickerTab === "discover" && (
              <div className="space-y-1">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Search by path…"
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600"
                  />
                  <select
                    value={skillTagFilter}
                    onChange={(e) => setSkillTagFilter(e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200"
                    title="Filter by tag"
                  >
                    <option value="">All tags</option>
                    {[...new Set(scopeItems.flatMap((i) => i.tags))].sort().map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-1.5">
                  <span className="text-xs text-zinc-500">Attachment:</span>
                  <select
                    value={skillPickerAttachmentMode}
                    onChange={(e) => setSkillPickerAttachmentMode(e.target.value as "inject" | "hard" | "soft")}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200"
                  >
                    {ATTACHMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value} title={m.desc}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {(() => {
                    const q = skillSearch.trim().toLowerCase();
                    const filtered = scopeItems.filter(
                      (i) =>
                        (!skillTagFilter || i.tags.includes(skillTagFilter)) &&
                        (!q || i.relPath.toLowerCase().includes(q))
                    );
                    return filtered.length === 0 ? (
                      <p className="text-xs text-zinc-500">No skills match</p>
                    ) : (
                      filtered.map((i) => (
                        <button
                          key={i.promptPath}
                          onClick={() => {
                            onChange({
                              ...value,
                              skillMds: [
                                ...(value.skillMds ?? []),
                                { mode: "custom", path: i.promptPath, attachmentMode: skillPickerAttachmentMode },
                              ],
                            });
                            setShowSkillPicker(false);
                          }}
                          className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                        >
                          {i.relPath}
                        </button>
                      ))
                    );
                  })()}
                </div>
              </div>
            )}

            {skillPickerTab === "custom" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="/path/to/skill.md"
                    value={customSkillPath}
                    onChange={(e) => setCustomSkillPath(e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                  />
                  <select
                    value={skillPickerAttachmentMode}
                    onChange={(e) => setSkillPickerAttachmentMode(e.target.value as "inject" | "hard" | "soft")}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200"
                    title="Attachment mode"
                  >
                    {ATTACHMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value} title={m.desc}>{m.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (customSkillPath.trim()) {
                        onChange({
                          ...value,
                          skillMds: [
                            ...(value.skillMds ?? []),
                            { mode: "custom", path: customSkillPath.trim(), attachmentMode: skillPickerAttachmentMode },
                          ],
                        });
                        setCustomSkillPath("");
                        setShowSkillPicker(false);
                      }
                    }}
                    className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
