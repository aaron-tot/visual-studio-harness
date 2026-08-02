import { useState, useCallback } from "react";
import { FileJson, X } from "lucide-react";
import type { PlanDocument, SpecDocument, SpecPlanPart } from "../../../../lib/api";
import { countCompleted, isPartDone } from "../../lib/plan-status";
import { PanelButton } from "../ui";

function PartsList({ parts, depth = 0 }: { parts?: SpecPlanPart[]; depth?: number }) {
  if (!parts || parts.length === 0) return null;
  return (
    <ul className="space-y-1" style={{ marginLeft: depth > 0 ? 8 : 0 }}>
      {parts.map((part) => {
        if (!part || typeof part !== "object") return null;
        return (
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
        );
      })}
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

function JsonModal({ doc, onClose }: { doc: SpecDocument | PlanDocument; onClose: () => void }) {
  const [jsonMode, setJsonMode] = useState<"pretty" | "raw">("pretty");
  const [copied, setCopied] = useState(false);

  const indent = jsonMode === "pretty" ? 2 : undefined;
  const json = JSON.stringify(doc, null, indent);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  }, [json]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-[90vw] max-w-3xl max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
          <span className="text-xs font-semibold text-zinc-400">
            {("endGoal" in doc ? "Plan" : "Spec")}
            {' v'}{doc.meta.version}
            {' — '}{doc.meta.id}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex bg-zinc-800 rounded text-[10px]">
              <button
                type="button"
                className={`px-2 py-0.5 rounded-l transition-colors ${jsonMode === "pretty" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                onClick={() => setJsonMode("pretty")}
              >
                Pretty
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 rounded-r transition-colors ${jsonMode === "raw" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                onClick={() => setJsonMode("raw")}
              >
                Raw
              </button>
            </div>
            <button
              type="button"
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 rounded bg-zinc-800"
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy JSON"}
            </button>
            <button
              type="button"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto p-4">
          <div className="text-[10px] text-zinc-600 mb-1">JSON · {json.length.toLocaleString()} bytes · {jsonMode} mode</div>
          <pre className="text-[11px] text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap break-all">
            {json}
          </pre>
        </div>
      </div>
    </div>
  );
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
  const [showJson, setShowJson] = useState(false);

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
        parts: <span className="tabular-nums">{countCompleted(doc.parts)}</span> completed
        <button
          type="button"
          className="inline-flex items-center ml-1.5 text-zinc-700 hover:text-zinc-400 align-middle transition-colors"
          onClick={(e) => { e.stopPropagation(); setShowJson(true); }}
          title="View full JSON"
        >
          <FileJson size={12} />
        </button>
      </div>
      <PartsList parts={doc.parts} />
      <div className="text-[10px] text-zinc-600 mt-1 space-y-0.5">
        <div>
          by: {doc.meta.createdBy} · {new Date(doc.meta.updatedAt).toLocaleDateString()}
        </div>
        <div className="text-zinc-700">{doc.meta.status}</div>
      </div>

      {showJson && <JsonModal doc={doc} onClose={() => setShowJson(false)} />}
    </div>
  );
}
