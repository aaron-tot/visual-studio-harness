import { useState } from "react";
import { Edit3, RefreshCw, X } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import type { SystemPromptJoiners, WorkspaceManifestSettings } from "../../../../_shared/types";

const DEFAULT_JOINERS: SystemPromptJoiners = {
  start: "",
  preGlobal: "<global>",
  postGlobal: "</global>",
  preAgent: "<agent>",
  postAgent: "</agent>",
  preSkills: "<skills>",
  postSkills: "</skills>",
  preProject: "<project>",
  postProject: "</project>",
  preRuntime: "<runtime>",
  postRuntime: "</runtime>",
  preTodoList: "<todoList>",
  postTodoList: "</todoList>",
  preWorkspaceManifest: "<workspaceManifest>",
  postWorkspaceManifest: "</workspaceManifest>",
  preExtras: "<extras>",
  postExtras: "</extras>",
  end: "",
};

const SECTIONS: Array<{
  label: string;
  preKey: keyof SystemPromptJoiners;
  postKey: keyof SystemPromptJoiners;
}> = [
  { label: "1. Base System Prompt (systemPromptBase.md)", preKey: "preGlobal", postKey: "postGlobal" },
  { label: "2. Agent MD attachment (agent definition)", preKey: "preAgent", postKey: "postAgent" },
  { label: "3. Skill MD attachments", preKey: "preSkills", postKey: "postSkills" },
  { label: "4. Project AGENTS.md", preKey: "preProject", postKey: "postProject" },
  { label: "5. Runtime info", preKey: "preRuntime", postKey: "postRuntime" },
  { label: "6. TODO List", preKey: "preTodoList", postKey: "postTodoList" },
  { label: "7. Workspace Manifest", preKey: "preWorkspaceManifest", postKey: "postWorkspaceManifest" },
  { label: "8. Extras", preKey: "preExtras", postKey: "postExtras" },
];

export function SystemPromptPanel() {
  const { config, update } = useConfigStore();
  const joiners: SystemPromptJoiners = config.systemPromptJoiners ?? DEFAULT_JOINERS;
  const [editingKey, setEditingKey] = useState<keyof SystemPromptJoiners | null>(null);
  const [editValue, setEditValue] = useState("");

  const patch = async (partial: Partial<SystemPromptJoiners>) => {
    const current = useConfigStore.getState().config;
    await update({
      ...current,
      systemPromptJoiners: { ...(current.systemPromptJoiners ?? DEFAULT_JOINERS), ...partial },
    });
  };

  const patchManifest = async (partial: Partial<WorkspaceManifestSettings>) => {
    const current = useConfigStore.getState().config;
    const currentManifest = current.workspaceManifest ?? { enabled: true };
    await update({
      ...current,
      workspaceManifest: { ...currentManifest, ...partial },
    });
  };

  const openEdit = (key: keyof SystemPromptJoiners) => {
    setEditValue(joiners[key] ?? "");
    setEditingKey(key);
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    await patch({ [editingKey]: editValue });
    setEditingKey(null);
    setEditValue("");
  };

  const resetOne = (key: keyof SystemPromptJoiners) => {
    patch({ [key]: DEFAULT_JOINERS[key] });
  };

  const resetAll = () => {
    const current = useConfigStore.getState().config;
    update({ ...current, systemPromptJoiners: { ...DEFAULT_JOINERS } });
  };

  const renderField = (key: keyof SystemPromptJoiners, label: string) => (
    <div key={key} className="flex items-start gap-2 py-1">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
        <div className="text-xs font-mono text-zinc-300 bg-zinc-950 rounded px-2 py-1 truncate whitespace-pre-wrap break-all">
          {joiners[key] || <span className="text-zinc-600 italic">empty</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 pt-3 shrink-0">
        <button
          type="button"
          onClick={() => openEdit(key)}
          className="p-1 text-zinc-500 hover:text-zinc-200 rounded hover:bg-zinc-800"
          title={`Edit ${label}`}
        >
          <Edit3 size={12} />
        </button>
        <button
          type="button"
          onClick={() => resetOne(key)}
          className="p-1 text-zinc-500 hover:text-zinc-200 rounded hover:bg-zinc-800"
          title={`Reset ${label} to default`}
        >
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-100">System Prompt Assembly</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Each section is wrapped with a customizable prefix and postfix.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800 shrink-0"
        >
          <RefreshCw size={12} />
          Reset all
        </button>
      </div>

        <div className="flex-1 space-y-2 overflow-y-auto">
        {SECTIONS.map((section, i) => (
          <div key={section.preKey} className="border border-zinc-800 rounded-lg p-3 space-y-1">
            <div className="text-xs text-zinc-300 font-medium mb-2">{section.label}</div>
            {renderField(section.preKey, "Prefix")}
            {renderField(section.postKey, "Postfix")}
            {section.preKey === "preWorkspaceManifest" && (
              <WorkspaceManifestSettings
                settings={config.workspaceManifest}
                onChange={patchManifest}
              />
            )}
          </div>
        ))}
      </div>

      {editingKey && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
          onClick={() => setEditingKey(null)}
        >
          <div
            className="relative bg-zinc-900 border border-zinc-800 rounded-lg w-[540px] max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
              <h2 className="text-sm font-medium text-zinc-200">
                Edit {editingKey}
              </h2>
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-2 text-sm font-mono text-zinc-200 resize-y min-h-[8rem]"
                rows={6}
                autoFocus
              />
              <p className="text-[10px] text-zinc-600 mt-1">
                This text is applied as-is. Use <code className="text-zinc-500">\n</code> for newlines.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_EXCLUDE_DIRS = "node_modules, .git, dist, build, .vsh, coverage, .turbo";
const DEFAULT_EXCLUDE_EXTS = ".png, .jpg, .jpeg, .gif, .svg, .ico, .woff2, .woff, .eot, .ttf";

const MANIFEST_DEFAULTS = {
  enabled: true,
  maxDepth: 3,
  includeFiles: false,
  excludeDirs: DEFAULT_EXCLUDE_DIRS.split(", "),
  excludeExtensions: DEFAULT_EXCLUDE_EXTS.split(", "),
};

function WorkspaceManifestSettings({
  settings,
  onChange,
}: {
  settings?: WorkspaceManifestSettings;
  onChange: (partial: Partial<WorkspaceManifestSettings>) => void;
}) {
  const enabled = settings?.enabled ?? true;
  const [dirsText, setDirsText] = useState(settings?.excludeDirs?.join(", ") ?? DEFAULT_EXCLUDE_DIRS);
  const [extsText, setExtsText] = useState(settings?.excludeExtensions?.join(", ") ?? DEFAULT_EXCLUDE_EXTS);

  const commitDirs = () => {
    const parsed = dirsText.split(",").map((s) => s.trim()).filter(Boolean);
    onChange({ excludeDirs: parsed.length > 0 ? parsed : undefined });
  };

  const commitExts = () => {
    const parsed = extsText.split(",").map((s) => s.trim()).filter(Boolean);
    onChange({ excludeExtensions: parsed.length > 0 ? parsed : undefined });
  };

  const resetAll = () => {
    onChange(MANIFEST_DEFAULTS);
    setDirsText(DEFAULT_EXCLUDE_DIRS);
    setExtsText(DEFAULT_EXCLUDE_EXTS);
  };

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
        />
        <div>
          <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
            Inject workspace manifest into system prompt
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Adds a tree view of your workspace to the system prompt so the agent
            understands the project structure.
          </div>
        </div>
      </label>

      {enabled && (
        <div className="ml-7 space-y-2">
          <button
            type="button"
            onClick={resetAll}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-zinc-500">Max depth</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings?.maxDepth ?? 3}
              onChange={(e) => onChange({ maxDepth: parseInt(e.target.value, 10) || 3 })}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            />
            <label className="flex items-center gap-1.5 ml-3">
              <input
                type="checkbox"
                checked={settings?.includeFiles ?? false}
                onChange={(e) => onChange({ includeFiles: e.target.checked })}
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
              onBlur={commitDirs}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 block mb-0.5">Excluded extensions (comma-separated)</label>
            <input
              type="text"
              value={extsText}
              onChange={(e) => setExtsText(e.target.value)}
              onBlur={commitExts}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            />
          </div>
        </div>
      )}
    </div>
  );
}
