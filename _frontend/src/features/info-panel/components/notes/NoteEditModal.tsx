import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { NoteEntry } from "../../../../lib/api";

interface NoteEditModalProps {
  note: NoteEntry;
  onSave: (title: string, body: string) => void;
  onClose: () => void;
  saving?: boolean;
}

export function NoteEditModal({ note, onSave, onClose, saving }: NoteEditModalProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[90vw] max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-base font-semibold text-zinc-200">Edit Note</h2>
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1 block">Body</label>
            <textarea
              className="w-full text-sm bg-zinc-800 text-zinc-200 px-3 py-2 rounded outline-none placeholder-zinc-600 resize-y min-h-[200px] border border-zinc-700 focus:border-zinc-500 transition-colors"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="text-[10px] text-zinc-600">
            Created: {new Date(note.meta.createdAt).toLocaleString()}
            {note.meta.updatedAt !== note.meta.createdAt && (
              <> · Updated: {new Date(note.meta.updatedAt).toLocaleString()}</>
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
            disabled={saving || !title.trim()}
            onClick={() => onSave(title, body)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
