import { create } from "zustand";
import type { SessionTodos, TodoItem, TodoStatus } from "../types";
import { emptySessionTodos } from "../types";
import { toggledComplete } from "../model/status";

interface TodoStore {
  bySession: Record<string, SessionTodos>;
  activeSessionId: string | null;

  setActiveSession: (sessionId: string | null) => void;
  /** Load from disk/API (or empty). Clears dirty. */
  hydrate: (sessionId: string, items: TodoItem[]) => void;
  getItems: (sessionId?: string | null) => TodoItem[];
  getSession: (sessionId?: string | null) => SessionTodos;

  add: (content: string, sessionId?: string | null) => void;
  setStatus: (id: string, status: TodoStatus, sessionId?: string | null) => void;
  toggleComplete: (id: string, sessionId?: string | null) => void;
  remove: (id: string, sessionId?: string | null) => void;
  replaceAll: (items: TodoItem[], sessionId?: string | null) => void;
  clearSession: (sessionId: string) => void;
}

function sid(get: () => TodoStore, sessionId?: string | null): string | null {
  return sessionId ?? get().activeSessionId;
}

function ensure(
  bySession: Record<string, SessionTodos>,
  id: string
): SessionTodos {
  return bySession[id] ?? emptySessionTodos();
}

function bump(
  prev: SessionTodos,
  items: TodoItem[],
  opts?: { hydrated?: boolean; dirty?: boolean }
): SessionTodos {
  return {
    items,
    version: prev.version + 1,
    hydrated: opts?.hydrated ?? prev.hydrated,
    dirty: opts?.dirty ?? true,
  };
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  bySession: {},
  activeSessionId: null,

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  hydrate: (sessionId, items) =>
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          items: [...items],
          version: (state.bySession[sessionId]?.version ?? 0) + 1,
          hydrated: true,
          dirty: false,
        },
      },
    })),

  getItems: (sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return [];
    return get().bySession[id]?.items ?? [];
  },

  getSession: (sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return emptySessionTodos();
    return get().bySession[id] ?? emptySessionTodos();
  },

  add: (content, sessionId) => {
    const id = sid(get, sessionId);
    if (!id || !content.trim()) return;
    set((state) => {
      const prev = ensure(state.bySession, id);
      const item: TodoItem = {
        id: crypto.randomUUID(),
        content: content.trim(),
        status: "pending",
      };
      return {
        bySession: {
          ...state.bySession,
          [id]: bump(prev, [...prev.items, item]),
        },
      };
    });
  },

  setStatus: (todoId, status, sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return;
    set((state) => {
      const prev = ensure(state.bySession, id);
      return {
        bySession: {
          ...state.bySession,
          [id]: bump(
            prev,
            prev.items.map((t) => (t.id === todoId ? { ...t, status } : t))
          ),
        },
      };
    });
  },

  toggleComplete: (todoId, sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return;
    set((state) => {
      const prev = ensure(state.bySession, id);
      return {
        bySession: {
          ...state.bySession,
          [id]: bump(
            prev,
            prev.items.map((t) => (t.id === todoId ? toggledComplete(t) : t))
          ),
        },
      };
    });
  },

  remove: (todoId, sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return;
    set((state) => {
      const prev = ensure(state.bySession, id);
      return {
        bySession: {
          ...state.bySession,
          [id]: bump(
            prev,
            prev.items.filter((t) => t.id !== todoId)
          ),
        },
      };
    });
  },

  replaceAll: (items, sessionId) => {
    const id = sid(get, sessionId);
    if (!id) return;
    set((state) => {
      const prev = ensure(state.bySession, id);
      return {
        bySession: {
          ...state.bySession,
          [id]: bump(prev, [...items], { dirty: true }),
        },
      };
    });
  },

  clearSession: (sessionId) =>
    set((state) => {
      const next = { ...state.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));
