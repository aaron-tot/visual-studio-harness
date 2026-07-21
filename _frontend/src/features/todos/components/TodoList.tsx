import type { TodoItem } from "../types";
import { TodoItemRow } from "./TodoItem";

interface Props {
  items: TodoItem[];
  emptyLabel?: string;
}

export function TodoList({
  items,
  emptyLabel = "No todos",
}: Props) {
  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-zinc-600 italic">{emptyLabel}</p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <TodoItemRow
          key={item.id}
          item={item}
        />
      ))}
    </div>
  );
}
