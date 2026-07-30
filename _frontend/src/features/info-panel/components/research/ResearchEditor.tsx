import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ResearchDoc, ResearchPoint } from "../../../../lib/api";
import { ResearchPointSection } from "./ResearchPointEditor";

interface ResearchEditorProps {
  doc: ResearchDoc;
  onSave: (doc: ResearchDoc) => void;
  onClose: () => void;
  saving?: boolean;
}

export function ResearchEditor({ doc, onSave, onClose, saving }: ResearchEditorProps) {
  const [goal, setGoal] = useState(doc.goal);
  const [initialPoints, setInitialPoints] = useState<ResearchPoint[]>(doc.initialQueryPoints);
  const [discoveredPoints, setDiscoveredPoints] = useState<ResearchPoint[]>(doc.discoveredQueryPoints);

  const handleSave = () => {
    onSave({
      meta: { ...doc.meta, updatedAt: new Date().toISOString() },
      goal: goal.trim(),
      initialQueryPoints: initialPoints,
      discoveredQueryPoints: discoveredPoints,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-base font-semibold text-zinc-200">Edit Research</h2>
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1 block">Title</label>
            <input
              type="text"
              className="w-full text-sm bg-zinc-800 text-zinc-200 px-3 py-2 rounded outline-none placeholder-zinc-600 border border-zinc-700 focus:border-zinc-500 transition-colors"
              value={doc.meta.title}
              disabled
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1 block">Goal</label>
            <textarea
              className="w-full text-sm bg-zinc-800 text-zinc-200 px-3 py-2 rounded outline-none placeholder-zinc-600 resize-y min-h-[48px] border border-zinc-700 focus:border-zinc-500 transition-colors"
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>

          <ResearchPointSection title="Initial Query Points" points={initialPoints} onUpdate={setInitialPoints} />
          <ResearchPointSection title="Discovered Query Points" points={discoveredPoints} onUpdate={setDiscoveredPoints} />

          <div className="text-[10px] text-zinc-600">
            Created: {new Date(doc.meta.createdAt).toLocaleString()}
            {doc.meta.updatedAt !== doc.meta.createdAt && (
              <> · Updated: {new Date(doc.meta.updatedAt).toLocaleString()}</>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 shrink-0">
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
            disabled={saving || !doc.meta.title.trim()}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
