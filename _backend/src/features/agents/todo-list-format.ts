import { getSessionTodosJson } from "../sessions/db";

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◎",
  completed: "✓",
  cancelled: "✗",
};

/**
 * Reads the current session TODO list from the DB and formats it as markdown.
 *
 * Returns null when there is no session ID, no data dir, no todos,
 * or the JSON cannot be parsed — so the todoList slot is simply omitted.
 */
export async function formatTodoList(
  sessionId: string | undefined,
  dataDir: string | undefined,
): Promise<string | null> {
  if (!sessionId?.trim() || !dataDir) return null;

  try {
    const raw = getSessionTodosJson(sessionId, dataDir);
    if (!raw) return null;

    const todos: Array<{
      id: string;
      content: string;
      status: string;
      priority?: string;
    }> = JSON.parse(raw);

    if (!Array.isArray(todos) || todos.length === 0) return null;

    const lines: string[] = ["## TODO List"];
    for (const t of todos) {
      const icon = STATUS_ICON[t.status] ?? "·";
      const prio = t.priority ? ` [${t.priority}]` : "";
      lines.push(`- ${icon} **${t.content}**${prio} — ${t.status}`);
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}
