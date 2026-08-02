import { useState } from "react";
import { Plus, X } from "lucide-react";

interface Props {
  raw: string;
  onRawChange: (raw: string) => void;
  allTags: string[];
}

type JsonState =
  | { ok: true; obj: Record<string, unknown> }
  | { ok: false; reason: string };

function jsonState(raw: string): JsonState {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "Top level must be a JSON object." };
    }
    return { ok: true, obj: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Invalid JSON." };
  }
}

function asTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Fixed mandatory-field editor for prompt.json:
 * createdAt/updatedAt are read-only (system-managed), name is stripped (folder name is authoritative),
 * tags is the only editable field (dropdown from existing tags + create new).
 */
export function MdsJsonForm({ raw, onRawChange, allTags }: Props) {
  const [selectValue, setSelectValue] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const state = jsonState(raw);

  const currentTags = state.ok ? asTags(state.obj.tags) : [];

  const commit = (tags: string[]) => {
    if (!state.ok) return;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.obj)) {
      if (k === "name") continue; // redundant — folder name is the name
      if (k === "tags") continue; // set below
      next[k] = v; // createdAt, updatedAt, and any future/unknown keys preserved
    }
    next.tags = tags;
    onRawChange(JSON.stringify(next, null, 2));
  };

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t || currentTags.includes(t)) return;
    commit([...currentTags, t]);
    setSelectValue("");
  };

  const removeTag = (tag: string) => {
    commit(currentTags.filter((t) => t !== tag));
  };

  const onSelect = (value: string) => {
    if (value === "__new__") {
      setShowNewTag(true);
      setNewTag("");
      setSelectValue("");
      return;
    }
    if (value) addTag(value);
  };

  if (!state.ok) {
    return (
      <div className="p-3 text-[11px] text-red-400">
        {state.reason} Switch to the Raw tab to fix it.
      </div>
    );
  }

  const availableTags = allTags.filter((t) => !currentTags.includes(t));

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="w-28 shrink-0 pt-1.5 font-mono text-[11px] text-zinc-500">createdAt</span>
        <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-zinc-400">
          {typeof state.obj.createdAt === "string" ? state.obj.createdAt : "—"}
        </span>
      </div>

      <div className="flex items-start gap-2">
        <span className="w-28 shrink-0 pt-1.5 font-mono text-[11px] text-zinc-500">updatedAt</span>
        <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-zinc-400">
          {typeof state.obj.updatedAt === "string" ? state.obj.updatedAt : "—"}
        </span>
      </div>

      <div className="flex items-start gap-2">
        <span className="w-28 shrink-0 pt-1.5 font-mono text-[11px] text-zinc-200">tags</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {currentTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-emerald-300"
              >
                {tag}
                <button
                  type="button"
                  title="Remove tag"
                  onClick={() => removeTag(tag)}
                  className="text-zinc-500 hover:text-red-400"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {currentTags.length === 0 && <span className="text-[11px] italic text-zinc-600">no tags</span>}
          </div>

          {showNewTag ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(newTag);
                    setShowNewTag(false);
                  }
                  if (e.key === "Escape") setShowNewTag(false);
                }}
                autoFocus
                placeholder="new tag name"
                className="w-40 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none placeholder-zinc-600 focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={() => {
                  addTag(newTag);
                  setShowNewTag(false);
                }}
                className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <Plus size={12} />
                Add
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                value={selectValue}
                onChange={(e) => onSelect(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-zinc-600"
              >
                <option value="">Add tag…</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {availableTags.length > 0 && <option disabled>──────────</option>}
                <option value="__new__">＋ Create new tag…</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
