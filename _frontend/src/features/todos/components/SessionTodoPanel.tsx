import { useEffect, useMemo, useState } from "react";
import { useTodoStore } from "../store/todoStore";
import { fetchSessionTodos } from "../api/todosApi";
import type { TodoFilterTab } from "../types";
import { countOpen, filterTodos } from "../model/filter";
import { TodoFilter } from "./TodoFilter";
import { TodoList } from "./TodoList";

interface Props {
  /** Defaults to store activeSessionId */
  sessionId?: string | null;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Read-only session todo panel.
 * Displays the state managed by the agent's Todo tool.
 * Automatically hydrates the store from the disk when the session changes.
 */
export function SessionTodoPanel({
  sessionId,
  defaultOpen = true,
  className = "",
}: Props) {
  const activeId = useTodoStore((s) => s.activeSessionId);
  const id = sessionId ?? activeId;
  const session = useTodoStore((s) =>
    id ? s.bySession[id] : undefined
  );

  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<TodoFilterTab>("all");
  const [search, setSearch] = useState("");

  // Hydrate the store from the agent's tool (disk) when the session changes
  useEffect(() => {
    if (!id) return;
    
    const loadTodos = async () => {
      try {
        const items = await fetchSessionTodos(id);
        useTodoStore.getState().hydrate(id, items);
      } catch (e) {
        console.warn("Failed to hydrate todos:", e);
      }
    };

    loadTodos();
  }, [id]);

  const items = session?.items ?? [];
  const openCount = useMemo(() => countOpen(items), [items]);
  const visible = useMemo(
    () => filterTodos(items, tab, search),
    [items, tab, search]
  );

  if (!id) {
    return (
      <div className={`rounded-lg border border-zinc-800 p-3 text-xs text-zinc-500 ${className}`}>
        No active session
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/50 ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-zinc-200">
          Todos
          {openCount > 0 && (
            <span className="ml-1.5 text-zinc-500">({openCount} open)</span>
          )}
        </span>
        <span className="text-[10px] text-zinc-500">{open ? "v" : ">"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <TodoFilter value={tab} onChange={setTab} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="ml-auto min-w-[6rem] flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-600"
            />
          </div>
          <TodoList
            items={visible}
            emptyLabel={
              !session?.hydrated
                ? "No todos yet (older sessions start empty until hydrate)"
                : "No todos match"
            }
          />
        </div>
      )}
    </div>
  );
}
