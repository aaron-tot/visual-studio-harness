import { useState } from "react";
import { createPortal } from "react-dom";
import type { PlanScope } from "../types";
import { scopeLabel } from "../lib/scope-params";

interface MoveScopeModalProps {
  title: string;
  currentScope: PlanScope;
  onClose: () => void;
  onMove: (toScope: PlanScope) => void;
}

export function MoveScopeModal({ title, currentScope, onClose, onMove }: MoveScopeModalProps) {
  const [target, setTarget] = useState<PlanScope>(
    currentScope === "global" ? "project" : "global",
  );
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-md border border-zinc-700 bg-zinc-900 p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-zinc-100 mb-3">{title}</h3>
        <p className="text-xs text-zinc-500 mb-3">
          Move this item from "{scopeLabel(currentScope)}" scope to another scope. The target
          scope must be available (workspace for Project, session id for Session) and must not
          already contain an item with the same name.
        </p>
        <div className="flex gap-2 mb-3">
          {(["global", "project", "session"] as PlanScope[])
            .filter((s) => s !== currentScope)
            .map((s) => (
              <button
                key={s}
                onClick={() => setTarget(s)}
                className={`rounded px-3 py-1.5 text-xs ${
                  target === s ? "bg-zinc-700 text-zinc-100" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {scopeLabel(s)}
              </button>
            ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onMove(target)}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500"
          >
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
