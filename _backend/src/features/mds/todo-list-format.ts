import { getSessionTodosJson } from "../sessions/db";

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◎",
  completed: "✓",
  cancelled: "✗",
};

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

    const lines: string[] = ["## TODO List","## Work on your TODO list, if it needs updating then update it. Never leave it incomplete. ##"];
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
