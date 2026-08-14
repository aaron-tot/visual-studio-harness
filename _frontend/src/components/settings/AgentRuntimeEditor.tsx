import { useState, useEffect, useCallback } from "react";
import { FileText, Edit3, Plus, AlertTriangle, Undo2 } from "lucide-react";
import type {
  AgentSettings,
  AgentMdConfig,
  AdditionalSystemInfoSettings,
  AdditionalSystemInfoVisibility,
  SkillMdConfig,
  SystemPromptSections,
  ThinkingEffort,
  WorkspaceManifestSettings,
} from "../../../../_shared/types";
import { DEFAULT_ADDITIONAL_SYSTEM_INFO, DEFAULT_SYSTEM_PROMPT_SECTIONS } from "../../../../_shared/types";

const DEFAULT_MANIFEST_DIRS = "node_modules, .git, dist, build, .vsh, coverage, .turbo";
const DEFAULT_MANIFEST_EXTS = ".png, .jpg, .jpeg, .gif, .svg, .ico, .woff2, .woff, .eot, .ttf";

const ATTACHMENT_MODES: { value: "inject" | "hard" | "soft"; label: string; desc: string }[] = [
  { value: "inject", label: "Inject", desc: "Embed in system prompt" },
  { value: "hard", label: "Hard", desc: "Must read before tasks" },
  { value: "soft", label: "Soft", desc: "Reference — use skill tool" },
];
import { useConfigStore } from "../../stores/config";
import { readMd, getMdsScopePaths, getMdsAgentsPaths, getMdsAgentsFile, type ScopeItem, type ScopePathEntry, type MdsAgentsFile } from "../../lib/api";
import type { PlanScope } from "../../features/info-panel/types";
import { MdsEditModal } from "../../features/mds/MdsEditModal";
import { AgentsMdEditModal } from "../../features/mds/AgentsMdEditModal";
import { useSessionStore } from "../../stores/sessions";
import { useChatStore } from "../../stores/chat";

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
  // AGENTS.md is a project (workspace) concept: resolve it against the CHAT session's
  // workspace — the same source the Prompts & Skills MDS view uses — so both settings
  // panels always agree on which workspace's AGENTS.md they show.
  const chatSessionId = useChatStore((s) => s.sessionId);
  const chatWorkspaceRoot = useChatStore((s) => s.workspaceRoot);
  const [globalSystemPromptBasePath, setGlobalSystemPromptBasePath] = useState<string | null>(null);
  const [workspaceAgentsMd, setWorkspaceAgentsMd] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [agentsFile, setAgentsFile] = useState<MdsAgentsFile | null>(null);
  const [agentsEditOpen, setAgentsEditOpen] = useState(false);
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

  const refreshWorkspaceAgents = useCallback(() => {
    const wsSessionId = chatSessionId || sessionId || undefined;
    const wsRoot = chatWorkspaceRoot || undefined;
    if (!wsSessionId && !wsRoot) {
      setAgentsFile(null);
      return;
    }
    getMdsAgentsPaths(wsSessionId, wsRoot).then((paths) => {
      setGlobalSystemPromptBasePath(paths.globalBase);
      setWorkspaceAgentsMd(paths.workspaceAgents);
      setWorkspaceRoot(paths.workspaceRoot);
    }).catch(() => {});
    getMdsAgentsFile({ sessionId: wsSessionId, workspaceRoot: wsRoot })
      .then((r) => setAgentsFile(r))
      .catch(() => setAgentsFile(null));
  }, [chatSessionId, chatWorkspaceRoot, sessionId]);

  useEffect(() => {
    refreshWorkspaceAgents();
  }, [refreshWorkspaceAgents]);

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

      {/* Additional System Info (per-agent override of the volatile tail) */}
      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-zinc-300">Additional System Info</h4>
          {value.additionalSystemInfo && (
            <button
              onClick={() => patch({ additionalSystemInfo: undefined })}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              title="Inherit the global additionalSystemInfo default"
            >
              <Undo2 className="h-3 w-3" />
              Inherit global
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          Per-agent override of the trailing volatile context block. Left empty, the global setting
          applies. When set, this agent's injections only include the selected sections and honor
          this visibility.
        </p>
        {(() => {
          const asi: AdditionalSystemInfoSettings = value.additionalSystemInfo ?? DEFAULT_ADDITIONAL_SYSTEM_INFO;
          const patchAsi = (partial: Partial<AdditionalSystemInfoSettings>) =>
            patch({ additionalSystemInfo: { ...asi, ...partial } });
          const toggleSection = (key: "runtime" | "todoList" | "workspaceManifest") => {
            const next = asi.sections.includes(key)
              ? asi.sections.filter((s) => s !== key)
              : [...asi.sections, key];
            patchAsi({ sections: next });
          };
          return (
            <>
              <div>
                <span className="text-xs text-zinc-400">Sections</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["runtime", "todoList", "workspaceManifest"] as const).map((key) => (
                    <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={asi.sections.includes(key)}
                        onChange={() => toggleSection(key)}
                        className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                      />
                      <span className="text-[11px] text-zinc-400">
                        {key === "runtime" ? "Runtime" : key}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">UI visibility</span>
                <select
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={asi.visibility}
                  onChange={(e) => patchAsi({ visibility: e.target.value as AdditionalSystemInfoVisibility })}
                >
                  <option value="hidden">Hidden</option>
                  <option value="collapsed">Collapsed (default)</option>
                  <option value="expanded">Expanded</option>
                </select>
              </label>

              <label className="flex items-start gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={asi.includeTime ?? false}
                  onChange={(e) => patchAsi({ includeTime: e.target.checked })}
                  className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                />
                <div>
                  <span className="text-[11px] text-zinc-400">includeTime</span>
                  <div className="text-[10px] text-amber-500/90 mt-0.5">
                    WARNING: includeTime embeds a timestamp, so additional_system_info is injected on
                    every step. Off: only injected when the manifest/todo list actually changes.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={asi.always ?? false}
                  onChange={(e) => patchAsi({ always: e.target.checked })}
                  className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                />
                <div>
                  <span className="text-[11px] text-zinc-400">Always inject (every step)</span>
                  <div className="text-[10px] text-amber-500/90 mt-0.5">
                    WARNING: always inject re-emits additional_system_info at the end of EVERY step
                    regardless of change, which over time can substantially increase token usage
                    (though it will be cached) — it can also potentially improve agent performance,
                    primarily due to the constant todo-list reminder. The enabled sections above
                    still apply.
                  </div>
                </div>
              </label>
            </>
          );
        })()}
      </div>

      {/* System Prompt Sections (per-agent override of the static bake) */}
      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-zinc-300">System Prompt Sections</h4>
          {value.systemPromptSections && (
            <button
              onClick={() => patch({ systemPromptSections: undefined })}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              title="Inherit the global systemPromptSections default"
            >
              <Undo2 className="h-3 w-3" />
              Inherit global
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          Per-agent override of which sections are ALSO baked into the static base system prompt
          (rebuilt once per turn — not refreshed per step). Left empty, the global setting applies.
        </p>
        <div className="text-[10px] text-amber-500/90 mt-1">
          ⚠ Warning: enabling this bakes sections into the static system prompt. If the baked
          content differs from the previous turn, it invalidates the entire cached context and
          forces a full recompute — use the per-step "Additional System Info" sections instead
          for dynamic content that changes frequently.
        </div>
        {(() => {
          const sysSec: SystemPromptSections = value.systemPromptSections ?? DEFAULT_SYSTEM_PROMPT_SECTIONS;
          const patchSec = (partial: Partial<SystemPromptSections>) =>
            patch({ systemPromptSections: { ...sysSec, ...partial } });
          return (
            <div className="space-y-1.5">
              {(["runtime", "todoList", "workspaceManifest"] as const).map((key) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sysSec[key]}
                    onChange={(e) => patchSec({ [key]: e.target.checked })}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] text-zinc-400">
                    {key === "runtime" ? "Runtime (workspace, mode, data_dir, os, datetime)" : key}
                  </span>
                </label>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Workspace Manifest (per-agent override) */}
      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-zinc-300">Workspace Manifest</h4>
          {value.workspaceManifest && (
            <button
              onClick={() => patch({ workspaceManifest: undefined })}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              title="Inherit the global workspaceManifest default"
            >
              <Undo2 className="h-3 w-3" />
              Inherit global
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          Per-agent override of the workspace manifest tree settings. Left empty, the global setting
          applies.
        </p>
        {(() => {
          const wm: WorkspaceManifestSettings = value.workspaceManifest ?? {};
          const patchWm = (partial: Partial<WorkspaceManifestSettings>) =>
            patch({ workspaceManifest: { ...wm, ...partial } });
          const setList = (key: "excludeDirs" | "excludeExtensions", text: string) => {
            const parsed = text.split(",").map((s) => s.trim()).filter(Boolean);
            patchWm({ [key]: parsed.length > 0 ? parsed : undefined });
          };
          const [dirsText, setDirsText] = useState(wm.excludeDirs?.join(", ") ?? DEFAULT_MANIFEST_DIRS);
          const [extsText, setExtsText] = useState(wm.excludeExtensions?.join(", ") ?? DEFAULT_MANIFEST_EXTS);
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-zinc-500">Max depth</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={wm.maxDepth ?? 3}
                  onChange={(e) => patchWm({ maxDepth: parseInt(e.target.value, 10) || 3 })}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                />
                <label className="flex items-center gap-1.5 ml-3">
                  <input
                    type="checkbox"
                    checked={wm.includeFiles ?? false}
                    onChange={(e) => patchWm({ includeFiles: e.target.checked })}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] text-zinc-500">Include files in tree</span>
                </label>
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 block mb-0.5">Excluded directories (comma-separated)</label>
                <input
                  type="text"
                  value={dirsText}
                  onChange={(e) => setDirsText(e.target.value)}
                  onBlur={() => setList("excludeDirs", dirsText)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 block mb-0.5">Excluded extensions (comma-separated)</label>
                <input
                  type="text"
                  value={extsText}
                  onChange={(e) => setExtsText(e.target.value)}
                  onBlur={() => setList("excludeExtensions", extsText)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                />
              </div>
            </div>
          );
        })()}
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
            <div className="flex shrink-0 items-center gap-1.5">
              {workspaceAgentsMd && (
                <span className="rounded border border-zinc-800 px-1.5 py-1 text-[10px] uppercase tracking-wide text-zinc-600">
                  auto-loaded
                </span>
              )}
              <button
                type="button"
                onClick={() => setAgentsEditOpen(true)}
                disabled={!agentsFile}
                title={agentsFile ? `Open ${agentsFile.path}` : "Resolving workspace…"}
                className="shrink-0 rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
              >
                {agentsFile ? (agentsFile.exists ? "Edit" : "Create") : "…"}
              </button>
            </div>
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
              {value.agentMd?.path ?? "Inline"}
              {value.agentMd?.path && scopeIndex[value.agentMd.path] && (
                <button
                  onClick={() => {
                    const hit = scopeIndex[value.agentMd!.path!];
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
            refreshWorkspaceAgents();
          }}
        />
      )}

      {agentsEditOpen && agentsFile && (
        <AgentsMdEditModal
          path={agentsFile.path}
          initialContent={agentsFile.content}
          sessionId={chatSessionId || sessionId || undefined}
          workspaceRoot={chatWorkspaceRoot || undefined}
          onClose={() => setAgentsEditOpen(false)}
          onSaved={refreshWorkspaceAgents}
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
