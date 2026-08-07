import { useState } from "react";
import { useConfigStore } from "../../stores/config";
import type { AdditionalSystemInfoSettings, AdditionalSystemInfoVisibility } from "../../../../_shared/types";

const DEFAULT_ASI: AdditionalSystemInfoSettings = {
  sections: ["runtime", "todoList", "workspaceManifest"],
  visibility: "collapsed",
  persist: true,
  includeTime: false,
};

const SECTION_LABELS: Record<string, { label: string; hint?: string }> = {
  runtime: { label: "Runtime", hint: "workspace, mode, data_dir, os, datetime, elapsed" },
  todoList: { label: "TODO List" },
  workspaceManifest: { label: "Workspace Manifest" },
};

/**
 * Edits `config.additionalSystemInfo` — the trailing volatile block injected as
 * a fabricated `additional_system_info` tool pair (context, not a real tool).
 * `includeTime: true` embeds a timestamp so a new injection is emitted on EVERY
 * step (shown with a warning); off ⇒ only injected when manifest/todo change.
 */
export function AdditionalSystemInfoPanel() {
  const { config, update } = useConfigStore();
  const asi: AdditionalSystemInfoSettings = config.additionalSystemInfo ?? DEFAULT_ASI;
  const [open, setOpen] = useState(false);

  const patch = async (partial: Partial<AdditionalSystemInfoSettings>) => {
    const current = useConfigStore.getState().config;
    await update({
      ...current,
      additionalSystemInfo: { ...(current.additionalSystemInfo ?? DEFAULT_ASI), ...partial },
    });
  };

  const toggleSection = async (key: "runtime" | "todoList" | "workspaceManifest") => {
    const current = asi.sections ?? DEFAULT_ASI.sections;
    const next = current.includes(key)
      ? current.filter((s) => s !== key)
      : [...current, key];
    await patch({ sections: next });
  };

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => setOpen(e.target.checked)}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
        />
        <div>
          <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
            Inject volatile context as a trailing `additional_system_info` block
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Emitted at the tail of each request (as fabricated tool context) so the
            stable leading system + history stays prompt-cache readable. Appended
            only when its content changes.
          </div>
        </div>
      </label>

      {open && (
        <div className="ml-7 space-y-3">
          {/* Sections to include */}
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Sections</div>
            <div className="flex flex-wrap gap-2">
              {(["runtime", "todoList", "workspaceManifest"] as const).map((key) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(asi.sections ?? DEFAULT_ASI.sections).includes(key)}
                    onChange={() => toggleSection(key)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs text-zinc-300">{SECTION_LABELS[key].label}</span>
                  {SECTION_LABELS[key].hint && (
                    <span className="text-[10px] text-zinc-500"> — {SECTION_LABELS[key].hint}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">UI visibility</label>
            <select
              value={asi.visibility ?? "collapsed"}
              onChange={(e) => patch({ visibility: e.target.value as AdditionalSystemInfoVisibility })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            >
              <option value="hidden">Hidden</option>
              <option value="collapsed">Collapsed (default)</option>
              <option value="expanded">Expanded</option>
            </select>
          </div>

          {/* Persist (always true in this design) */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={asi.persist ?? true}
              onChange={(e) => patch({ persist: e.target.checked })}
              className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <span className="text-[11px] text-zinc-500">Persist emitted injections (replay verbatim)</span>
          </label>

          {/* includeTime with warning */}
          <label className="flex items-start gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={asi.includeTime ?? false}
              onChange={(e) => patch({ includeTime: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <span className="text-[11px] text-zinc-500">includeTime</span>
              <div className="text-[10px] text-amber-500/90 mt-0.5">
                WARNING: includeTime embeds a timestamp, so additional_system_info is
                injected on every step. Off: only injected when the manifest/todo list
                actually changes.
              </div>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
