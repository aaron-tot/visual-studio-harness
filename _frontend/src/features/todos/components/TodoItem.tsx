import type { TodoItem as TodoItemType } from "../types";
import { isChecked, statusLabel } from "../model/status";

interface Props {
  item: TodoItemType;
}

const badgeClass: Record<string, string> = {
  pending: "bg-zinc-800 text-zinc-400",
  in_progress: "bg-amber-900/40 text-amber-300",
  completed: "bg-zinc-800/80 text-zinc-500",
  cancelled: "bg-zinc-900 text-zinc-600 line-through",
};

export function TodoItemRow({ item }: Props) {
  const done = isChecked(item);

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5">
      <span
        className={`min-w-0 flex-1 text-xs ${
          done ? "text-zinc-500 line-through" : "text-zinc-200"
        }`}
      >
        {item.content}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
          badgeClass[item.status] ?? badgeClass.pending
        }`}
      >
        {statusLabel(item.status)}
      </span>
    </div>
  );
}
