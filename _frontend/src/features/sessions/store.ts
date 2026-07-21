import { create } from "zustand";
import type { GroupColor, SessionMeta, LayoutNode } from "../../_shared/types";
import {
  listSessions,
  deleteSession as apiDelete,
  renameSession as apiRename,
  getSessionLayout,
  putSessionLayout,
} from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { useSessionViewStore } from "../../stores/sessionView";

interface SessionState {
  sessions: SessionMeta[];
  loading: boolean;
  activeId: string | null;
  /** workspaceRoot → persisted layout tree. */
  layouts: Record<string, LayoutNode[]>;
  fetch: () => Promise<void>;
  setActive: (id: string | null) => void;
  archive: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  upsertSession: (meta: SessionMeta) => void;
  loadLayout: (workspaceRoot: string) => Promise<void>;
  saveLayout: (workspaceRoot: string, tree: LayoutNode[]) => Promise<void>;
  addGroup: (workspaceRoot: string, title: string, color?: GroupColor) => Promise<void>;
  renameGroup: (workspaceRoot: string, groupId: string, title: string) => Promise<void>;
  recolorGroup: (workspaceRoot: string, groupId: string, color: GroupColor) => Promise<void>;
  removeGroup: (workspaceRoot: string, groupId: string) => Promise<void>;
  /** sessionId → true while that session is actively streaming (any client view). */
  streamingSessions: Record<string, true>;
  /** sessionId → true when a response finished while the user was NOT viewing it. */
  doneNotifications: Record<string, true>;
  setStreaming: (sessionId: string, streaming: boolean) => void;
  setDoneNotification: (sessionId: string, done: boolean) => void;
  clearDoneNotification: (sessionId: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  activeId: null,
  layouts: {},
  streamingSessions: {},
  doneNotifications: {},
  fetch: async () => {
    set({ loading: true });
    try {
      const sessions = await listSessions();
      set({ sessions, loading: false });
      const workspaces = Array.from(new Set(sessions.map((s) => s.workspaceRoot ?? "")));
      await Promise.all(workspaces.map((ws) => get().loadLayout(ws)));
    } catch {
      set({ loading: false });
    }
  },
  setActive: (id) => {
    set((state) => {
      const doneNotifications = id ? { ...state.doneNotifications } : state.doneNotifications;
      if (id) delete doneNotifications[id];
      return { activeId: id, doneNotifications };
    });
    if (id) {
      useSessionViewStore.getState().setCurrentSession(id);
      useChatStore.getState().loadSession(id);
    } else {
      useSessionViewStore.getState().setCurrentSession(null);
    }
  },
  archive: async (id) => {
    const wasActive = get().activeId === id;
    // If archiving the currently-active session while it's streaming, stop streaming locally too.
    if (wasActive && get().streamingSessions[id]) {
      useChatStore.getState().stopStreaming();
    }
    await apiDelete(id);
    set({ sessions: get().sessions.filter((s) => s.id !== id), activeId: wasActive ? null : get().activeId });
    // If the archived session was open on screen, navigate to the new-session page.
    if (wasActive) {
      useChatStore.getState().clearMessages();
    }
  },
  rename: async (id, title) => {
    await apiRename(id, title);
    set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, title } : s)) });
  },
  upsertSession: (meta) =>
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === meta.id);
      if (idx >= 0) {
        const sessions = [...state.sessions];
        sessions[idx] = meta;
        return { sessions };
      }
      return { sessions: [meta, ...state.sessions] };
    }),
  setStreaming: (sessionId, streaming) =>
    set((state) => {
      const streamingSessions = { ...state.streamingSessions };
      if (streaming) {
        streamingSessions[sessionId] = true;
        // A fresh stream supersedes any stale finished notification.
        const doneNotifications = { ...state.doneNotifications };
        delete doneNotifications[sessionId];
        return { streamingSessions, doneNotifications };
      }
      delete streamingSessions[sessionId];
      return { streamingSessions };
    }),
  setDoneNotification: (sessionId, done) =>
    set((state) => {
      const doneNotifications = { ...state.doneNotifications };
      if (done) doneNotifications[sessionId] = true;
      else delete doneNotifications[sessionId];
      return { doneNotifications };
    }),
  clearDoneNotification: (sessionId) =>
    set((state) => {
      if (!state.doneNotifications[sessionId]) return {};
      const doneNotifications = { ...state.doneNotifications };
      delete doneNotifications[sessionId];
      return { doneNotifications };
    }),
  loadLayout: async (workspaceRoot) => {
    try {
      const res = await getSessionLayout(workspaceRoot);
      const tree: LayoutNode[] = res.tree ?? [];
      set((state) => ({ layouts: { ...state.layouts, [workspaceRoot]: tree } }));
    } catch {
      /* leave undefined; UI falls back to default ordering */
    }
  },
  saveLayout: async (workspaceRoot, tree) => {
    set((state) => ({ layouts: { ...state.layouts, [workspaceRoot]: tree } }));
    try {
      await putSessionLayout(workspaceRoot, tree);
    } catch {
      /* keep optimistic state; backend reloads as source of truth */
    }
  },
  addGroup: async (workspaceRoot, title, color = "neutral") => {
    const cur = get().layouts[workspaceRoot] ?? [];
    const newGroup: LayoutNode = {
      kind: "group",
      id: crypto.randomUUID(),
      name: title,
      color,
      children: [],
    };
    await get().saveLayout(workspaceRoot, [...cur, newGroup]);
  },
  renameGroup: async (workspaceRoot, groupId, title) => {
    const cur = get().layouts[workspaceRoot] ?? [];
    const next = cur.map((n) =>
      n.id === groupId && n.kind === "group" ? { ...n, name: title } : n
    );
    await get().saveLayout(workspaceRoot, next);
  },
  recolorGroup: async (workspaceRoot, groupId, color) => {
    const cur = get().layouts[workspaceRoot] ?? [];
    const next = cur.map((n) =>
      n.id === groupId && n.kind === "group" ? { ...n, color } : n
    );
    await get().saveLayout(workspaceRoot, next);
  },
  removeGroup: async (workspaceRoot, groupId) => {
    const cur = get().layouts[workspaceRoot] ?? [];
    function dissolve(nodes: LayoutNode[]): LayoutNode[] {
      const result: LayoutNode[] = [];
      for (const n of nodes) {
        if (n.id === groupId && n.kind === "group") {
          result.push(...(n.children || []).map((c) =>
            c.kind === "session" ? c : { ...c }
          ));
        } else {
          result.push(n);
        }
      }
      return result;
    }
    await get().saveLayout(workspaceRoot, dissolve(cur));
  },
}));
