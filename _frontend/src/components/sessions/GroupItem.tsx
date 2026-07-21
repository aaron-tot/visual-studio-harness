import { useState } from "react";
import { Trash2, Palette } from "lucide-react";
import type { GroupColor } from "../../../../_shared/types";
import type { SessionGroupLayout } from "../../features/sessions/layout";
import { GROUP_COLOR_KEYS, groupColorClass } from "../../features/sessions/layout";

interface GroupItemProps {
  group: SessionGroupLayout;
  onRename: (title: string) => void;
  onRecolor: (color: GroupColor) => void;
  onDelete: () => void;
}

export function GroupItem({ group, onRename, onRecolor, onDelete }: GroupItemProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(group.name);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== group.name) onRename(trimmed);
    else setValue(group.name);
    setEditing(false);
  };

  const cls = groupColorClass[group.color ?? "neutral"];

  return (
    <div
      data-testid="session-group"
      data-group-id={group.id}
      data-color={group.color ?? "neutral"}
    >
      <div
        className={`group flex items-center gap-1.5 px-2 py-1 rounded border ${cls.bg} ${cls.border}`}
      >
        {editing ? (
          <input
            data-testid="group-rename-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setValue(group.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="flex-1 text-sm font-medium px-1 py-0.5 rounded outline-none bg-zinc-900 text-zinc-200"
          />
        ) : (
          <span
            data-testid="group-title"
            onDoubleClick={() => {
              setValue(group.name);
              setEditing(true);
            }}
            className={`flex-1 truncate text-sm font-medium ${cls.text}`}
            title={group.name}
          >
            {group.name}
          </span>
        )}

        <button
          type="button"
          data-testid="group-palette"
          onClick={() => setPaletteOpen((o) => !o)}
          aria-label="Group color"
          className={`p-1 rounded transition-all ${paletteOpen ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100"}`}
        >
          <Palette size={14} />
        </button>
        <button
          type="button"
          data-testid="group-delete"
          onClick={onDelete}
          aria-label="Delete group"
          className="p-1 rounded text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {paletteOpen && (
        <div
          data-testid="group-palette-menu"
          className="flex items-center gap-1.5 px-2 py-1.5 mt-0.5 rounded bg-zinc-900 border border-zinc-800"
        >
          {GROUP_COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`group-color-${c}`}
              onClick={() => {
                onRecolor(c);
                setPaletteOpen(false);
              }}
              aria-label={`Color ${c}`}
              className={`w-4 h-4 rounded-full ${groupColorClass[c].dot} ${
                (group.color ?? "neutral") === c ? "ring-2 ring-offset-1 ring-offset-zinc-900 ring-zinc-300" : ""
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
