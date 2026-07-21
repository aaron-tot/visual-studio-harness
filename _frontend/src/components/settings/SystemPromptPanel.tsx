import { useState } from "react";
import { Edit3, RefreshCw, X } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import type { SystemPromptJoiners } from "../../../../_shared/types";

const DEFAULT_JOINERS: SystemPromptJoiners = {
  start: "",
  afterGlobal: "\n\n",
  afterAgentMd: "\n\n",
  afterSkillMds: "\n\n",
  afterProject: "\n\n",
  afterRuntime: "\n\n",
  afterTodoList: "\n\n",
  afterExtras: "\n\n",
  end: "",
};

const SECTION_LABELS = [
  "1. Global agents.md",
  "2. Agent MD attachment",
  "3. Skill MD attachments",
  "4. Project agents.md",
  "5. Runtime info",
  "6. TODO List",
  "7. Extras",
];

const JOINER_KEYS: (keyof SystemPromptJoiners)[] = [
  "start",
  "afterGlobal",
  "afterAgentMd",
  "afterSkillMds",
  "afterProject",
  "afterRuntime",
  "afterTodoList",
  "afterExtras",
  "end",
];

const JOINER_LABELS: Record<string, string> = {
  start: "Start prefix",
  afterGlobal: "After Global",
  afterAgentMd: "After Agent MD",
  afterSkillMds: "After Skill MDs",
  afterProject: "After Project",
  afterRuntime: "After Runtime",
  afterTodoList: "After TODO List",
  afterExtras: "After Extras",
  end: "End suffix",
};

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

  const openEdit = (key: keyof SystemPromptJoiners) => {
    setEditValue(joiners[key]);
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

  const renderJoinerRow = (key: keyof SystemPromptJoiners) => (
    <div key={key} className="flex items-start gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-500 mb-0.5">{JOINER_LABELS[key]}</div>
        <div className="text-xs font-mono text-zinc-300 bg-zinc-950 rounded px-2 py-1 truncate whitespace-pre-wrap break-all">
          {joiners[key] || <span className="text-zinc-600 italic">empty</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 pt-4 shrink-0">
        <button
          type="button"
          onClick={() => openEdit(key)}
          className="p-1 text-zinc-500 hover:text-zinc-200 rounded hover:bg-zinc-800"
          title={`Edit ${JOINER_LABELS[key]}`}
        >
          <Edit3 size={14} />
        </button>
        <button
          type="button"
          onClick={() => resetOne(key)}
          className="p-1 text-zinc-500 hover:text-zinc-200 rounded hover:bg-zinc-800"
          title={`Reset ${JOINER_LABELS[key]} to default`}
        >
          <RefreshCw size={14} />
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
            Separators between each section. Each present section is auto-wrapped with <code className="text-zinc-500">&lt;tag&gt;</code> / <code className="text-zinc-500">&lt;/tag&gt;</code>.
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

      <div className="flex-1 space-y-0">
        {renderJoinerRow("start")}

        {SECTION_LABELS.map((label, i) => (
          <div key={label}>
            <div className="py-1.5 px-2 rounded my-2 bg-zinc-950/40 border border-zinc-800/50">
              <span className="text-xs text-zinc-300">{label}</span>
            </div>
            {renderJoinerRow(JOINER_KEYS[i + 1])}
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
                Edit {JOINER_LABELS[editingKey]}
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
                This text is inserted between sections as-is. Use <code className="text-zinc-500">\n</code> for newlines.
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
