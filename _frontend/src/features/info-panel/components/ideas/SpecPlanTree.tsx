import type { PlanDocument, SpecDocument, SpecPlanPart } from "../../../../lib/api";
import { countCompleted, isPartDone } from "../../lib/plan-status";

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

export function SpecPlanDocView({
  label,
  version,
  doc,
}: {
  label: string;
  version: number;
  doc: SpecDocument | PlanDocument;
}) {
  const goal =
    "endGoal" in doc && doc.endGoal
      ? doc.endGoal
      : "goal" in doc && doc.goal
        ? doc.goal
        : null;

  return (
    <div className="pb-2 border-b border-zinc-800 last:border-b-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[10px] font-semibold text-zinc-500">{label}</span>
        <span className="text-[9px] text-zinc-600">v{version}</span>
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
