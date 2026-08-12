import { useRef, useState } from "react";
import { writeMdsAgentsFile } from "../../lib/api";

interface Props {
  path: string;
  initialContent: string;
  sessionId?: string;
  workspaceRoot?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Editor for the project-scope AGENTS.md (workspace root). Creates the file on save when missing. */
export function AgentsMdEditModal({ path, initialContent, sessionId, workspaceRoot, onClose, onSaved }: Props) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeMdsAgentsFile({ content, sessionId, workspaceRoot });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-zinc-200">{path}</div>
            <div className="text-[10px] text-zinc-500">project scope · AGENTS.md (workspace root)</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-1.5 text-[11px] text-red-400">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 p-3">
          <textarea
            ref={areaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") onClose();
            }}
            spellCheck={false}
            autoFocus
            className="h-full w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none focus:border-zinc-600"
          />
        </div>
      </div>
    </div>
  );
}
