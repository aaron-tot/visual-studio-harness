import type { TodoItem, TodoStatus } from "../types";

export function isOpenStatus(status: TodoStatus): boolean {
  return status === "pending" || status === "in_progress";
}

export function isDoneStatus(status: TodoStatus): boolean {
  return status === "completed";
}

export function isCancelledStatus(status: TodoStatus): boolean {
  return status === "cancelled";
}

/** Checkbox checked state */
export function isChecked(item: TodoItem): boolean {
  return item.status === "completed";
}

/** Toggle complete <-> pending (simple UI checkbox) */
export function toggledComplete(item: TodoItem): TodoItem {
  if (item.status === "completed") {
    return { ...item, status: "pending" };
  }
  return { ...item, status: "completed" };
}

export function statusLabel(status: TodoStatus): string {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "in progress";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
  }
}
