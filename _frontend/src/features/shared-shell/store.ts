import { create } from "zustand";
import { wsClient } from "../../lib/ws";
import {
  createShellApi,
  listShellsApi,
  writeShellApi,
  resizeShellApi,
  closeShellApi,
  getShellOutputApi,
  closeSessionShellsApi,
} from "./api";
import type { Shell, ShellStatus } from "./types";

interface SharedShellState {
  /** sessionId -> ordered shells belonging to that session. */
  bySession: Record<string, Shell[]>;
  /** sessionId -> shellId of the active shell for that session (if any). */
  activeBySession: Record<string, string | null>;
  /** shellId -> accumulated output from the backend (tail). */
  outputByShell: Record<string, string>;

  /** Fetch the shell list for a session from the backend. */
  listShells: (sessionId: string) => Promise<void>;
  /** Create a shell for a session via the backend. */
  createShell: (sessionId: string, name?: string) => Promise<Shell>;
  /** Close (remove) a shell for a session via the backend. */
  closeShell: (sessionId: string, shellId: string) => Promise<void>;
  /** Activate a shell for a session. */
  selectShell: (sessionId: string, shellId: string) => void;
  /** Write raw data to a shell (send a command). */
  writeShell: (shellId: string, data: string) => Promise<void>;
  /** Resize a shell's PTY window. */
  resizeShell: (shellId: string, cols: number, rows: number) => Promise<void>;
  /** Clear all shells for a session (archive). */
  clearSession: (sessionId: string) => Promise<void>;
  /** Reset display state for a session (session switch). */
  resetSession: (sessionId: string) => void;
}

interface ShellMsg {
  type: string;
  payload?: { id?: string; sessionId?: string; data?: string; shell?: Shell };
}

function isShellMsg(data: unknown): data is ShellMsg {
  return typeof data === "object" && data !== null && "type" in (data as Record<string, unknown>);
}

let wsInitRan = false;

/** Wire REST calls + WS broadcasts into the shared-shell store. Idempotent. */
export function initSharedShellWs(): () => void {
  if (wsInitRan) return () => {};
  wsInitRan = true;
  const onOutput = (data: unknown) => {
    if (!isShellMsg(data)) return;
    if (data.type !== "shell:output") return;
    const id = data.payload?.id;
    if (!id) return;
    useSharedShellStore.setState((s) => ({
      outputByShell: {
        ...s.outputByShell,
        [id]: (s.outputByShell[id] ?? "") + (data.payload?.data ?? ""),
      },
    }));
  };
  const onCreated = (data: unknown) => {
    if (!isShellMsg(data)) return;
    if (data.type !== "shell:created" || !data.payload?.shell) return;
    const shell = data.payload.shell;
    useSharedShellStore.setState((s) => ({
      bySession: {
        ...s.bySession,
        [shell.sessionId]: [...(s.bySession[shell.sessionId] ?? []).filter((x) => x.id !== shell.id), shell],
      },
      activeBySession: { ...s.activeBySession, [shell.sessionId]: shell.id },
      outputByShell: { ...s.outputByShell, [shell.id]: "" },
    }));
  };
  const onClosed = (data: unknown) => {
    if (!isShellMsg(data)) return;
    if (data.type !== "shell:closed" && data.type !== "shell:updated") return;
    const id = data.payload?.id;
    const sessionId = data.payload?.sessionId;
    if (!id || !sessionId) return;
    useSharedShellStore.setState((s) => {
      const shells = (s.bySession[sessionId] ?? []).map((sh) =>
        sh.id === id ? { ...sh, status: "stopped" as ShellStatus } : sh
      );
      return { bySession: { ...s.bySession, [sessionId]: shells } };
    });
  };

  wsClient.on("shell:output", onOutput);
  wsClient.on("shell:created", onCreated);
  wsClient.on("shell:closed", onClosed);
  wsClient.on("shell:updated", onClosed);
  return () => {
    wsClient.off("shell:output", onOutput);
    wsClient.off("shell:created", onCreated);
    wsClient.off("shell:closed", onClosed);
    wsClient.off("shell:updated", onClosed);
  };
}

export const useSharedShellStore = create<SharedShellState>((set, get) => ({
  bySession: {},
  activeBySession: {},
  outputByShell: {},

  listShells: async (sessionId) => {
    const { shells } = await listShellsApi(sessionId);
    // Pull each shell's real accumulated buffer so the terminal shows output
    // from the very start, not just whatever arrives over WS after subscribing.
    const outputs: Record<string, string> = {};
    for (const sh of shells) {
      try {
        outputs[sh.id] = (await getShellOutputApi(sh.id)).output;
      } catch {
        /* backend shell may have vanished */
      }
    }
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: shells },
      outputByShell: { ...s.outputByShell, ...outputs },
    }));
  },

  createShell: async (sessionId, name) => {
    const res = await createShellApi(sessionId, name);
    if (!res.ok || !res.shell) {
      throw new Error(res.error || "Failed to create shell");
    }
    // shell:created WS normally adds; but add locally here for reliability.
    const shell = res.shell;
    let output = "";
    try {
      output = (await getShellOutputApi(shell.id)).output;
    } catch {
      /* none yet */
    }
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: [...(s.bySession[sessionId] ?? []).filter((x) => x.id !== shell.id), shell],
      },
      activeBySession: { ...s.activeBySession, [sessionId]: shell.id },
      outputByShell: { ...s.outputByShell, [shell.id]: output },
    }));
    return shell;
  },

  closeShell: async (sessionId, shellId) => {
    await closeShellApi(shellId);
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: (s.bySession[sessionId] ?? []).filter((x) => x.id !== shellId) },
      activeBySession: {
        ...s.activeBySession,
        [sessionId]:
          s.activeBySession[sessionId] === shellId ? null : s.activeBySession[sessionId],
      },
    }));
  },

  selectShell: (sessionId, shellId) => {
    set((s) => ({ activeBySession: { ...s.activeBySession, [sessionId]: shellId } }));
  },

  writeShell: async (shellId, data) => {
    await writeShellApi(shellId, data);
  },

  resizeShell: async (shellId, cols, rows) => {
    await resizeShellApi(shellId, cols, rows);
  },

  clearSession: async (sessionId) => {
    try {
      await closeSessionShellsApi(sessionId);
    } catch {
      /* best-effort backend cleanup */
    }
    set((s) => {
      const bySession = { ...s.bySession };
      const activeBySession = { ...s.activeBySession };
      const outputByShell = { ...s.outputByShell };
      (bySession[sessionId] ?? []).forEach((sh) => delete outputByShell[sh.id]);
      delete bySession[sessionId];
      delete activeBySession[sessionId];
      return { bySession, activeBySession, outputByShell };
    });
  },

  resetSession: (sessionId) => {
    set((s) => {
      const bySession = { ...s.bySession };
      const activeBySession = { ...s.activeBySession };
      const outputByShell = { ...s.outputByShell };
      (bySession[sessionId] ?? []).forEach((sh) => delete outputByShell[sh.id]);
      delete bySession[sessionId];
      delete activeBySession[sessionId];
      return { bySession, activeBySession, outputByShell };
    });
  },
}));
