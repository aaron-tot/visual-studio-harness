/**
 * Session todos HTTP API.
 * Wire backend routes later to the same todos.json as todowrite/todoread.
 */
import type { TodoItem } from "../types";
import { parseTodosJson, toApiBody } from "../adapters/disk";

const BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined && options.body !== null;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`todos API ${res.status}`);
  return res.json();
}

/** GET /api/sessions/:id/todos — returns { todos } or raw array when implemented */
export async function fetchSessionTodos(sessionId: string): Promise<TodoItem[]> {
  try {
    const data = await fetchJson<unknown>(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/todos`
    );
    return parseTodosJson(data);
  } catch {
    // Endpoint may not exist yet — treat as empty hydrate
    return [];
  }
}

export async function saveSessionTodos(
  sessionId: string,
  items: TodoItem[]
): Promise<void> {
  await fetchJson(`${BASE}/sessions/${encodeURIComponent(sessionId)}/todos`, {
    method: "PUT",
    body: JSON.stringify({ todos: toApiBody(items) }),
  });
}
