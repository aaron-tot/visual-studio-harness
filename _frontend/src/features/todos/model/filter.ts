import type { TodoFilterTab, TodoItem } from "../types";
import { isDoneStatus, isOpenStatus } from "./status";

export function filterTodos(
  items: TodoItem[],
  tab: TodoFilterTab,
  search = ""
): TodoItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    if (tab === "active" && !isOpenStatus(item.status)) return false;
    if (tab === "completed" && !isDoneStatus(item.status)) return false;
    if (q && !item.content.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function countOpen(items: TodoItem[]): number {
  return items.filter((i) => isOpenStatus(i.status)).length;
}
