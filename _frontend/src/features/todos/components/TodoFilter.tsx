import type { TodoFilterTab } from "../types";

const TABS: { id: TodoFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
];

interface Props {
  value: TodoFilterTab;
  onChange: (tab: TodoFilterTab) => void;
}

export function TodoFilter({ value, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`rounded-md px-2 py-1 text-[11px] ${
            value === t.id
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
