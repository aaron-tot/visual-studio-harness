import { create } from "zustand";
import type { Shell, ShellStatus } from "./types";

/** Prefix for generated shell ids. */
const SHELL_ID_PREFIX = "shell-";

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${SHELL_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${SHELL_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SharedShellState {
  /** sessionId -> ordered shells belonging to that session. */
  bySession: Record<string, Shell[]>;
  /** sessionId -> shellId of the active shell for that session (if any). */
  activeBySession: Record<string, string>;

  /** Shells for a given session (ordered). */
  shellsFor: (sessionId: string) => Shell[];
  /** Active shell id for a session, or null. */
  activeFor: (sessionId: string) => string | null;

  /** Create a shell for a session; returns the new shell. */
  createShell: (sessionId: string, name?: string) => Shell;
  /** Close (remove) a shell for a session. */
  closeShell: (sessionId: string, shellId: string) => void;
  /** Activate a shell for a session. */
  selectShell: (sessionId: string, shellId: string) => void;
  /** Clear all shells for a session (archive/timeout/navigation). */
  clearSession: (sessionId: string) => void;
  /** Update a shell's status (used by future PTY wiring). */
  setStatus: (sessionId: string, shellId: string, status: ShellStatus) => void;
}

export const useSharedShellStore = create<SharedShellState>((set, get) => ({
  bySession: {},
  activeBySession: {},

  shellsFor: (sessionId) => get().bySession[sessionId] ?? [],

  activeFor: (sessionId) => get().activeBySession[sessionId] ?? null,

  createShell: (sessionId, name) => {
    const shell: Shell = {
      id: makeId(),
      name: name ?? `Shell ${(get().bySession[sessionId]?.length ?? 0) + 1}`,
      sessionId,
      status: "starting",
      createdAt: Date.now(),
    };
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: [...(state.bySession[sessionId] ?? []), shell],
      },
      activeBySession: { ...state.activeBySession, [sessionId]: shell.id },
    }));
    return shell;
  },

  closeShell: (sessionId, shellId) => {
    const shells = get().bySession[sessionId] ?? [];
    const remaining = shells.filter((s) => s.id !== shellId);
    const nextActive = get().activeBySession[sessionId];
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: remaining },
      activeBySession: {
        ...state.activeBySession,
        [sessionId]: nextActive === shellId ? (remaining[remaining.length - 1]?.id ?? null) : nextActive,
      },
    }));
  },

  selectShell: (sessionId, shellId) => {
    set((state) => ({
      activeBySession: { ...state.activeBySession, [sessionId]: shellId },
    }));
  },

  clearSession: (sessionId) => {
    set((state) => {
      const bySession = { ...state.bySession };
      const activeBySession = { ...state.activeBySession };
      delete bySession[sessionId];
      delete activeBySession[sessionId];
      return { bySession, activeBySession };
    });
  },

  setStatus: (sessionId, shellId, status) => {
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: (state.bySession[sessionId] ?? []).map((s) =>
          s.id === shellId ? { ...s, status } : s
        ),
      },
    }));
  },
}));
