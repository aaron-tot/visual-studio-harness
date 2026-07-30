import { useCallback, useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import type { SpecPlanPart } from "../../../../lib/api";
import { isPartDone } from "../../lib/plan-status";

/* ------------------------------------------------------------------ */
/*  StringField — single text input or textarea                        */
/* ------------------------------------------------------------------ */

export function StringField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      {multiline ? (
        <textarea
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-blue-500 min-h-[60px] resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <input
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditableStringList — array of strings with add/remove/inline edit  */
/* ------------------------------------------------------------------ */

export function EditableStringList({
  label,
  items = [],
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [newItem, setNewItem] = useState("");

  const handleAdd = useCallback(() => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setNewItem("");
  }, [newItem, items, onChange]);

  const handleRemove = useCallback(
    (idx: number) => {
      const next = items.filter((_, i) => i !== idx);
      onChange(next);
    },
    [items, onChange],
  );

  const handleEdit = useCallback(
    (idx: number, v: string) => {
      const next = items.map((item, i) => (i === idx ? v : item));
      onChange(next);
    },
    [items, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  return (
    <div>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
        {label}
        <span className="text-zinc-600 font-normal ml-1.5">({items.length})</span>
      </div>
      <div className="space-y-1">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1 group">
            <GripVertical size={12} className="text-zinc-700 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            <input
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
              value={item}
              onChange={(e) => handleEdit(idx, e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="text-zinc-600 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              onClick={() => handleRemove(idx)}
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <input
            className="flex-1 bg-zinc-900 border border-dashed border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
            placeholder={`Add ${label.toLowerCase()}...`}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 disabled:opacity-30"
            onClick={handleAdd}
            disabled={!newItem.trim()}
            title="Add"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditablePartsField — JSON editor for SpecPlanPart[]                */
/* ------------------------------------------------------------------ */

export function EditablePartsField({
  label,
  parts = [],
  onChange,
}: {
  label: string;
  parts: SpecPlanPart[];
  onChange: (parts: SpecPlanPart[]) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(parts, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = (v: string) => {
    setRaw(v);
    try {
      const parsed = JSON.parse(v) as SpecPlanPart[];
      onChange(parsed);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const { done, total } = countPartsFlat(parts);

  return (
    <div>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
        {label}
        <span className="text-zinc-600 font-normal ml-1.5">
          ({parts.length}{total > 0 && <> · {done}/{total} done</>})
        </span>
      </div>
      {parseError && <div className="text-xs text-red-400 mb-1 font-mono">{parseError}</div>}
      <textarea
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-blue-500 min-h-[120px] resize-y"
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

/** Flat count of parts done/total (non-recursive for JSON editor summary) */
function countPartsFlat(parts: SpecPlanPart[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const p of parts) {
    total++;
    if (isPartDone(p.status)) done++;
  }
  return { done, total };
}
