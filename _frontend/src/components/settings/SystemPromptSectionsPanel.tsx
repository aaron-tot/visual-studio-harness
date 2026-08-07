import { useConfigStore } from "../../stores/config";
import type { SystemPromptSections } from "../../../../_shared/types";
import { DEFAULT_SYSTEM_PROMPT_SECTIONS } from "../../../../_shared/types/config";

const SECTION_LABELS: Record<keyof SystemPromptSections, { label: string; desc: string; warn?: string }> = {
  runtime: {
    label: "Runtime (static)",
    desc: "Static runtime facts — workspace, mode, data_dir, os, session_id.",
  },
  datetime: {
    label: "Runtime (dynamic)",
    desc: "Datetime + time spent on the turn.",
    warn: "WARNING: includes a timestamp that changes every turn — toggling this on busts the prefix cache whenever the clock changes.",
  },
  todoList: {
    label: "TODO List",
    desc: "Current TODO list snapshot.",
  },
  workspaceManifest: {
    label: "Workspace Manifest",
    desc: "Directory tree snapshot.",
  },
};

const ORDER: (keyof SystemPromptSections)[] = ["runtime", "datetime", "todoList", "workspaceManifest"];

/**
 * Controls which dynamic sections are ALSO baked into the static base system
 * prompt. The base is rebuilt once per turn and is byte-identical within the
 * turn, so content here is NOT refreshed per step — the note tells users to
 * also enable the section under additional_system_info for fresh content.
 */
export function SystemPromptSectionsPanel() {
  const { config, update } = useConfigStore();
  const sections: SystemPromptSections = config.systemPromptSections ?? DEFAULT_SYSTEM_PROMPT_SECTIONS;

  const patch = async (partial: Partial<SystemPromptSections>) => {
    const current = useConfigStore.getState().config;
    await update({
      ...current,
      systemPromptSections: { ...(current.systemPromptSections ?? DEFAULT_SYSTEM_PROMPT_SECTIONS), ...partial },
    });
  };

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="text-xs text-zinc-300 font-medium">Also include in the base system prompt</div>
      <p className="text-[11px] text-zinc-500">
        The system prompt is static per turn (built at the start of each turn). Sections toggled
        here are baked once and are <span className="text-zinc-400">not refreshed per step</span> —
        if you want the agent to see potentially updated content, also toggle the section on in the
        Additional System Info section below.
      </p>
      <div className="space-y-2 pt-1">
        {ORDER.map((key) => {
          const meta = SECTION_LABELS[key];
          return (
            <label key={key} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sections[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
                className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <div>
                <div className="text-xs text-zinc-300">{meta.label}</div>
                <div className="text-[11px] text-zinc-500">{meta.desc}</div>
                {meta.warn && (
                  <div className="text-[10px] text-amber-500/90 mt-0.5">{meta.warn}</div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
