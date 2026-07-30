import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import type { ResearchEntry } from "../../../../lib/api";
import type { DesignLocation } from "../../types";

interface ResearchCardProps {
  entry: ResearchEntry;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  location: DesignLocation;
}

export function ResearchCard({
  entry,
  expanded,
  onToggle,
  busy,
  onEdit,
  onDelete,
}: ResearchCardProps) {
  const { document: doc } = entry;
  const totalPoints =
    doc.initialQueryPoints.length + doc.discoveredQueryPoints.length;

  return (
    <div>
      {/* Header */}
      <div
        className="w-full flex items-center gap-1 pr-3 py-1.5 hover:bg-zinc-900 transition-colors group cursor-pointer px-3"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-zinc-600" />
        )}
        <span className="text-xs text-zinc-300 truncate flex-1">
          {doc.meta.title}
        </span>
        <span className="text-[9px] text-zinc-600 shrink-0">
          {totalPoints} pts
        </span>
        <span className="text-[9px] text-zinc-600 shrink-0 ml-1">
          {new Date(doc.meta.createdAt).toLocaleDateString()}
        </span>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit research"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete research"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-6 pb-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {doc.goal && (
            <div className="text-[11px] text-zinc-400 whitespace-pre-wrap leading-relaxed">
              <span className="text-zinc-600 font-medium">Goal: </span>
              {doc.goal}
            </div>
          )}
          {!doc.goal && (
            <div className="text-[11px] text-zinc-600 italic">(no goal)</div>
          )}

          {doc.initialQueryPoints.length > 0 && (
            <div className="text-[10px] text-zinc-600">
              Initial points: {doc.initialQueryPoints.length}
            </div>
          )}
          {doc.discoveredQueryPoints.length > 0 && (
            <div className="text-[10px] text-zinc-600">
              Discovered: {doc.discoveredQueryPoints.length}
            </div>
          )}

          <div className="flex gap-1 pt-1">
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              disabled={busy}
              onClick={onEdit}
            >
              <Pencil size={10} className="inline mr-0.5" />
              Edit
            </button>
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-red-700 hover:text-red-200 transition-colors"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={10} className="inline mr-0.5" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
