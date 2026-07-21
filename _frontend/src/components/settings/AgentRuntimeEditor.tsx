import { useState, useEffect } from "react";
import { FileText, Edit3, Plus } from "lucide-react";
import type {
  AgentSettings,
  SkillMdConfig,
  ThinkingEffort,
} from "../../../../_shared/types";
import { useConfigStore } from "../../stores/config";
import { listMds, readMd } from "../../lib/api";
import { useSessionStore } from "../../stores/sessions";
import { MdEditorModal } from "./MdEditorModal";

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
  const [customSkillPath, setCustomSkillPath] = useState("");
  const [showAgentMdPicker, setShowAgentMdPicker] = useState(false);
  const [agentMdPickerTab, setAgentMdPickerTab] = useState<"discover" | "custom">("discover");
  const [customAgentMdPath, setCustomAgentMdPath] = useState("");

  const sessionId = useSessionStore((s) => s.activeId ?? s.sessions[0]?.id);
  const [roots, setRoots] = useState<{ mds: string; workspace: string } | null>(null);
  const [globalAgentsMd, setGlobalAgentsMd] = useState<string | null>(null);
  const [workspaceAgentsMd, setWorkspaceAgentsMd] = useState<string | null>(null);
  const [agentTaggedMds, setAgentTaggedMds] = useState<{ path: string; fullPath: string }[]>([]);
  const [skillTaggedMds, setSkillTaggedMds] = useState<{ path: string; fullPath: string }[]>([]);
  const [editingMd, setEditingMd] = useState<{ path: string; tag: string; content: string; source?: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    listMds(sessionId).then((result) => {
      setRoots(result.roots);
      let global: string | null = null;
      let workspace: string | null = null;
      for (const [section, entries] of Object.entries(result.entries)) {
        for (const entry of entries) {
          const name = entry.path.split("/").pop()?.toLowerCase();
          if (name === "agents.md" || name === "agends.md") {
            if (section === "workspace") {
              workspace = entry.fullPath ?? entry.path;
            } else {
              global = entry.fullPath ?? entry.path;
            }
          }
        }
      }
      setGlobalAgentsMd(global);
      setWorkspaceAgentsMd(workspace);
      const agentTagged: { path: string; fullPath: string }[] = [];
      for (const entries of Object.values(result.entries)) {
        for (const entry of entries) {
          if (entry.tags.includes("agent")) {
            agentTagged.push({ path: entry.path, fullPath: entry.fullPath ?? entry.path });
          }
        }
      }
      setAgentTaggedMds(agentTagged);
      const skillTagged: { path: string; fullPath: string }[] = [];
      for (const entries of Object.values(result.entries)) {
        for (const entry of entries) {
          if (entry.tags.includes("skill")) {
            skillTagged.push({ path: entry.path, fullPath: entry.fullPath ?? entry.path });
          }
        }
      }
      setSkillTaggedMds(skillTagged);
    }).catch(() => {});
  }, [sessionId]);
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

        {/* Global agents.md */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">Global system message</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {globalAgentsMd ?? "Not found"}
                </p>
              </div>
            </div>
            {globalAgentsMd && (
              <button
                onClick={async () => {
                  try {
                    const { content } = await readMd(sessionId, globalAgentsMd);
                    setEditingMd({ path: globalAgentsMd, tag: "agent", content, source: "global" });
                  } catch {}
                }}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            This system message stays the same regardless of session or workspace.
          </p>
        </div>

        {/* Workspace agents.md */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">Workspace system message</p>
                {workspaceAgentsMd ? (
                  <p className="truncate text-[11px] text-zinc-500">{workspaceAgentsMd}</p>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    No agents.md found in workspace root{roots ? ` (${roots.workspace})` : ""}
                  </p>
                )}
              </div>
            </div>
            {workspaceAgentsMd && (
              <button
                onClick={async () => {
                  try {
                    const { content } = await readMd(sessionId, workspaceAgentsMd);
                    setEditingMd({ path: workspaceAgentsMd, tag: "agent", content, source: "workspace" });
                  } catch {}
                }}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            This system message is tied to the current workspace. A session in a different
            workspace will use its own workspace&apos;s agents.md.
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
            <span className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              {value.agentMd.path ?? "Inline"}
              {value.agentMd.path && (
                <button
                  onClick={async () => {
                    try {
                      const { content } = await readMd(sessionId, value.agentMd.path!);
                      setEditingMd({ path: value.agentMd.path!, tag: "agent", content });
                    } catch {}
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
              <div className="max-h-40 overflow-y-auto space-y-1">
                {agentTaggedMds.length === 0 ? (
                  <p className="text-xs text-zinc-500">No agent Mds discovered</p>
                ) : (
                  agentTaggedMds.map((md) => (
                    <button
                      key={md.fullPath}
                      onClick={() => {
                        onChange({
                          ...value,
                          agentMd: { mode: "existing", path: md.fullPath },
                        });
                        setShowAgentMdPicker(false);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      {md.path}
                    </button>
                  ))
                )}
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

      {/* MD Editor Modal */}
      {editingMd && roots && (
        <MdEditorModal
          sessionId={sessionId}
          roots={roots}
          initialMd={editingMd}
          onClose={() => setEditingMd(null)}
          onSaved={() => {
            setEditingMd(null);
            // Refresh to get updated content
            listMds(sessionId).then((result) => {
              let global: string | null = null;
              let workspace: string | null = null;
              for (const [section, entries] of Object.entries(result.entries)) {
                for (const entry of entries) {
                  const name = entry.path.split("/").pop()?.toLowerCase();
                  if (name === "agents.md" || name === "agends.md") {
                    if (section === "workspace") {
                      workspace = entry.fullPath ?? entry.path;
                    } else {
                      global = entry.fullPath ?? entry.path;
                    }
                  }
                }
              }
              setGlobalAgentsMd(global);
              setWorkspaceAgentsMd(workspace);
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
              return (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                >
                  {skill.mode === "existing" ? skill.name ?? "Unnamed" : skill.path ?? "Custom"}
                  {skillPath && (
                    <button
                      onClick={async () => {
                        try {
                          const { content } = await readMd(sessionId, skillPath);
                          setEditingMd({ path: skillPath, tag: "skill", content });
                        } catch {}
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
              <div className="max-h-40 overflow-y-auto space-y-1">
                {skillTaggedMds.length === 0 ? (
                  <p className="text-xs text-zinc-500">No skills discovered</p>
                ) : (
                  skillTaggedMds.map((md) => (
                    <button
                      key={md.fullPath}
                      onClick={() => {
                        onChange({
                          ...value,
                          skillMds: [
                            ...(value.skillMds ?? []),
                            { mode: "custom", path: md.fullPath },
                          ],
                        });
                        setShowSkillPicker(false);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      {md.path}
                    </button>
                  ))
                )}
              </div>
            )}

            {skillPickerTab === "custom" && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="/path/to/skill.md"
                  value={customSkillPath}
                  onChange={(e) => setCustomSkillPath(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                />
                <button
                  onClick={() => {
                    if (customSkillPath.trim()) {
                      onChange({
                        ...value,
                        skillMds: [
                          ...(value.skillMds ?? []),
                          { mode: "custom", path: customSkillPath.trim() },
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
