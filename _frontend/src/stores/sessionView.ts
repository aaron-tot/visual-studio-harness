import { create } from "zustand";

export interface ContextDoc {
  id: string;
  type: "spec" | "plan";
  planName: string;
  version: number;
  label: string;
  content: string;
}

interface SessionViewState {
  currentSessionId: string | null;
  setCurrentSession: (sessionId: string | null) => void;
  sessionContext: ContextDoc[];
  addContext: (doc: ContextDoc) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
}

export const useSessionViewStore = create<SessionViewState>((set, get) => ({
  currentSessionId: null,

  setCurrentSession: (sessionId) => {
    set({ currentSessionId: sessionId });
  },

  sessionContext: [],

  addContext: (doc) => {
    const existing = get().sessionContext.find((c) => c.id === doc.id);
    if (existing) return;
    set({ sessionContext: [...get().sessionContext, doc] });
  },

  removeContext: (id) => {
    set({ sessionContext: get().sessionContext.filter((c) => c.id !== id) });
  },

  clearContext: () => {
    set({ sessionContext: [] });
  },
}));
