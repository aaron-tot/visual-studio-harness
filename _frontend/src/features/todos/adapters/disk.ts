/**
 * Parse / serialize the same JSON shape backend tools use.
 * Keep this as the only edge for file/API payloads.
 */
import type { TodoItem, TodoPriority, TodoStatus } from "../types";

const STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const PRIORITIES = new Set<TodoPriority>(["high", "medium", "low"]);

function asStatus(v: unknown): TodoStatus | null {
  return typeof v === "string" && STATUSES.has(v as TodoStatus)
    ? (v as TodoStatus)
    : null;
}

function asPriority(v: unknown): TodoPriority | undefined {
  return typeof v === "string" && PRIORITIES.has(v as TodoPriority)
    ? (v as TodoPriority)
    : undefined;
}

/** Accepts array or { todos: [] }. Drops invalid rows. */
export function parseTodosJson(raw: unknown): TodoItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray((raw as { todos?: unknown }).todos)) {
    list = (raw as { todos: unknown[] }).todos;
  } else {
    return [];
  }

  const out: TodoItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    // Legacy UI field "text" accepted as content for upgrade safety
    const content =
      typeof r.content === "string"
        ? r.content
        : typeof r.text === "string"
          ? r.text
          : null;
    let status = asStatus(r.status);
    // Legacy boolean completed
    if (!status && typeof r.completed === "boolean") {
      status = r.completed ? "completed" : "pending";
    }
    if (!id || content === null || !status) continue;
    const item: TodoItem = { id, content, status };
    const priority = asPriority(r.priority);
    if (priority) item.priority = priority;
    out.push(item);
  }
  return out;
}

export function serializeTodosJson(items: TodoItem[]): string {
  return JSON.stringify(items, null, 2) + "\n";
}

export function toApiBody(items: TodoItem[]): TodoItem[] {
  return items.map((i) => {
    const row: TodoItem = { id: i.id, content: i.content, status: i.status };
    if (i.priority) row.priority = i.priority;
    return row;
  });
}
