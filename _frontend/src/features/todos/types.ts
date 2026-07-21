/** Canonical todo shape — same as backend todowrite/todoread + todos.json */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
}

export type TodoFilterTab = "all" | "active" | "completed";

export interface SessionTodos {
  items: TodoItem[];
  version: number;
  /** True after load from disk/API (or explicit empty hydrate) */
  hydrated: boolean;
  dirty: boolean;
}

export function emptySessionTodos(): SessionTodos {
  return {
    items: [],
    version: 0,
    hydrated: false,
    dirty: false,
  };
}
