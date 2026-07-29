import { useState } from "react";
import type { PlanDocument, SpecDocument, SpecPlanPart } from "../../../../lib/api";
import { countCompleted, isPartDone } from "../../lib/plan-status";
import { PanelButton } from "../ui";

function PartsList({ parts, depth = 0 }: { parts: SpecPlanPart[]; depth?: number }) {
  if (parts.length === 0) return null;
  return (
    <ul className="space-y-1" style={{ marginLeft: depth > 0 ? 8 : 0 }}>
      {parts.map((part) => (
        <li key={part.id}>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] ${
                isPartDone(part.status) ? "text-emerald-500" : "text-zinc-600"
              }`}
            >
              {isPartDone(part.status) ? "✓" : "○"}
            </span>
            <span className="text-[11px] text-zinc-300">{part.name}</span>
            <span className="text-[8px] text-zinc-600">{part.type}</span>
          </div>
          {part.description && (
            <div className="text-[10px] text-zinc-500 ml-4">{part.description}</div>
          )}
          <PartsList parts={part.parts} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

function goalField(doc: SpecDocument | PlanDocument): string {
  if ("endGoal" in doc && doc.endGoal) return doc.endGoal;
  if ("goal" in doc && doc.goal) return doc.goal;
  return "";
}

function setGoalField(doc: SpecDocument | PlanDocument, value: string): Record<string, unknown> {
  if ("endGoal" in doc) return { endGoal: value, goal: value };
  return { goal: value, endGoal: value };
}

export function SpecPlanDocView({
  label,
  version,
  doc,
  editing,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  label: string;
  version: number;
  doc: SpecDocument | PlanDocument;
  editing: boolean;
  onEdit: () => void;
  onSave: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [editGoal, setEditGoal] = useState(goalField(doc));

  const goal = goalField(doc);

  if (editing) {
    return (
      <div className="pb-2 border-b border-zinc-800 last:border-b-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-semibold text-zinc-500">{label}</span>
          <span className="text-[9px] text-zinc-600">v{version}</span>
          <span className="text-[9px] text-emerald-600 ml-auto">Editing</span>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-zinc-600">Goal / End Goal</div>
          <textarea
            className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1.5 rounded outline-none placeholder-zinc-600 resize-none min-h-[60px]"
            value={editGoal}
            onChange={(e) => setEditGoal(e.target.value)}
          />
          <div className="flex gap-1">
            <PanelButton
              className="flex-1 py-1"
              disabled={saving}
              onClick={() => onSave(setGoalField(doc, editGoal))}
            >
              {saving ? "Saving..." : "Save"}
            </PanelButton>
            <PanelButton
              className="flex-1 py-1"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </PanelButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-2 border-b border-zinc-800 last:border-b-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[10px] font-semibold text-zinc-500">{label}</span>
        <span className="text-[9px] text-zinc-600">v{version}</span>
        <button
          type="button"
          className="text-[9px] ml-auto text-zinc-700 hover:text-zinc-400 transition-colors"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          Edit
        </button>
      </div>
      {goal && <div className="text-[10px] text-zinc-500 mb-1 italic">{goal}</div>}
      <div className="text-[10px] text-zinc-600 mb-1">
        parts: {countCompleted(doc.parts)} completed
      </div>
      <PartsList parts={doc.parts} />
      <div className="text-[10px] text-zinc-600 mt-1 space-y-0.5">
        <div>
          by: {doc.meta.createdBy} · {new Date(doc.meta.updatedAt).toLocaleDateString()}
        </div>
        <div className="text-zinc-700">{doc.meta.status}</div>
      </div>
    </div>
  );
}
