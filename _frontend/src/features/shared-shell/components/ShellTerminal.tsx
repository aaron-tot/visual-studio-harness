import { useCallback, useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useSharedShellStore } from "../store";
import { getShellSnapshotApi, putShellSnapshotApi } from "../api";
import { SHELL_THEME } from "../theme";
import type { Shell, ShellSnapshot } from "../types";

interface ShellTerminalProps {
  shell: Shell;
  /** Whether this terminal is the currently-visible one in the panel. When
   *  false the xterm instance is kept alive but hidden, so its exact
   *  live-rendered colour/state is preserved across shell switches. */
  active?: boolean;
}

const PERSIST_DEBOUNCE_MS = 300;

/**
 * Real interactive terminal rendered with xterm.js, mirroring VSCode's
 * integrated terminal. Backend PTY output is written into the xterm buffer;
 * keystrokes are forwarded back to the PTY so colours, job control and
 * full-screen apps behave natively.
 *
 * Restore model: instead of replaying a raw PTY byte log (which re-runs every
 * escape sequence against the current geometry and corrupts layout/colour), the
 * xterm's already-rendered state is captured with @xterm/addon-serialize and
 * persisted to the backend. On mount (refresh) the snapshot is written back via
 * term.write() for an exact pixel-for-pixel restore, then live WS output takes
 * over. The first time a terminal is made visible it hydrates from the
 * snapshot; hidden shells stay live but are only rendered once shown.
 */
export function ShellTerminal({ shell, active = false }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  // True until this terminal's snapshot has been restored. The live store
  // subscriber holds back while set; once hydrated we drain buffered output.
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  // Synchronised with `active` so the mount-time ResizeObserver and serializers
  // can tell whether this terminal is actually visible (a hidden terminal must
  // NOT be fit to 0×0 — that destroys its layout and stops snapshot persistence).
  const activeRef = useRef(active);
  activeRef.current = active;
  // The last known non-zero terminal size. Hidden terminals never fit, so their
  // xterm keeps this real dimension.
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);

  // Explicitly forward the xterm's CURRENT geometry to the backend PTY. The PTY
  // is created at 80x24; if it stays there while the browser xterm is wider,
  // bash's line editor wraps at 80 cols but the viewer shows more.
  const pushSize = useCallback(() => {
    const t = xtermRef.current;
    if (!t) return;
    const cols = t.cols;
    const rows = t.rows;
    if (cols > 0 && rows > 0) {
      lastDimsRef.current = { cols, rows };
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
    }
  }, [shell.id]);

  // Serialize the current rendered terminal and persist it to the backend so a
  // refresh restores the exact view (colours + cursor + layout).
  const persistSnapshot = useCallback(() => {
    const t = xtermRef.current;
    const s = serializeRef.current;
    if (!t || !s) return;
    // Use the last known real size: a hidden terminal's xterm still holds its
    // full rendered buffer (colour + cursor) even though it isn't fit, so it
    // must keep serializing with its last valid dimensions.
    const dims = lastDimsRef.current;
    if (!dims) return;
    let serialized = "";
    try {
      serialized = s.serialize();
    } catch {
      return;
    }
    if (!serialized) return;
    putShellSnapshotApi(shell.id, dims.cols, dims.rows, serialized).catch(() => {});
  }, [shell.id]);

  // Debounce-schedule a snapshot persist (avoids a POST per keystroke/byte).
  // TRAILING edge: every new write resets the timer, so the snapshot is captured
  // from the settled final frame — not from a fixed offset after the FIRST write
  // of a burst (which could drop a late-arriving output line like `echo` → its
  // result → prompt).
  const schedulePersist = useCallback(() => {
    dirtyRef.current = true;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        persistSnapshot();
      }
    }, PERSIST_DEBOUNCE_MS);
  }, [persistSnapshot]);

  // Flush any pending snapshot immediately (unload, hidden); no debounce.
  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (dirtyRef.current) {
      dirtyRef.current = false;
      persistSnapshot();
    }
  }, [persistSnapshot]);

  // Initialise xterm once per shell mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || xtermRef.current) return;

    const term = new Xterm({
      fontSize: 13,
      fontFamily: "JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace",
      cursorBlink: true,
      theme: SHELL_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serializeAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);

    xtermRef.current = term;
    fitRef.current = fit;
    serializeRef.current = serializeAddon;

    // Keep course as the terminal viewport fits again on later layouts. Only
    // refit a VISIBLE terminal — a hidden one must keep its last real size (and
    // the 0×0 it would get from fitting a display:none container) so its buffer
    // and persisted snapshot stay intact.
    const ro = new ResizeObserver(() => {
      if (!activeRef.current) return;
      fit.fit();
      pushSize();
    });
    ro.observe(el);

    // Forward keystrokes to the backend PTY.
    const dataSub = term.onData((data) => {
      useSharedShellStore.getState().writeShell(shell.id, data).catch(() => {});
    });

    // Ensure Ctrl+C / Ctrl+V / Ctrl+X behave like a real terminal.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return true;
      const key = e.key.toLowerCase();
      if (key === "v") {
        // Let the browser fire its native paste event (xterm picks it up).
        return false;
      }
      if (key === "c" || key === "x") {
        // If terminal text is selected, give the browser plain copy/cut.
        if (term.hasSelection()) return false;
        return true;
      }
      return true;
    });

    // Clicking anywhere gives xterm's textarea focus so keydown/paste reach it.
    const onPointerDown = () => {
      term.focus();
    };
    el.addEventListener("pointerdown", onPointerDown);

    const resizeSub = term.onResize(({ cols, rows }) => {
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
      // SIGWINCH makes bash reprint the prompt; wait for that reprint to
      // settle before snapshotting or we persist wrap leftovers.
      schedulePersist();
    });

    return () => {
      flushPersist();
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      serializeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.id]);

  // Live output push: subscribe to this shell's output buffer and write any new
  // deltas into xterm, then clear them + persist a snapshot. Held back until the
  // terminal has been hydrated so a snapshot restore and the WS push don't
  // double-render the same bytes.
  useEffect(() => {
    const unsub = useSharedShellStore.subscribe((state) => {
      const term = xtermRef.current;
      if (!term) return;
      if (!hydratedRef.current) return;
      const data = state.outputByShell[shell.id];
      if (!data) return;
      term.write(data);
      useSharedShellStore.setState((s) => ({
        outputByShell: { ...s.outputByShell, [shell.id]: "" },
      }));
      schedulePersist();
    });
    return () => {
      unsub();
    };
  }, [shell.id, schedulePersist]);

  // When this terminal becomes visible: hydrate from the persisted snapshot the
  // first time (refresh / first show), then fit + sync geometry + focus. Hidden
  // shells keep their xterm alive and only get rendered once shown.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const id = requestAnimationFrame(async () => {
      const term = xtermRef.current;
      const fit = fitRef.current;
      const serializeAddon = serializeRef.current;
      if (!term || !fit || !serializeAddon) return;

      if (!hydratedRef.current) {
        let snapshot: ShellSnapshot | null = null;
        try {
          const res = await getShellSnapshotApi(shell.id);
          snapshot = res?.snapshot ?? null;
        } catch {
          snapshot = null;
        }
        if (cancelled) return;

        // Lay out at the snapshot's original geometry, write the serialized
        // content (exact colour/cursor restore), then refit to this viewport.
        if (snapshot && snapshot.serialized && snapshot.cols > 0 && snapshot.rows > 0) {
          term.resize(snapshot.cols, snapshot.rows);
          term.write(snapshot.serialized);
        }

        hydratedRef.current = true;

        // Drain any live bytes that accumulated in the store while gated.
        const pending = useSharedShellStore.getState().outputByShell[shell.id];
        if (pending) {
          term.write(pending);
          useSharedShellStore.setState((s) => ({
            outputByShell: { ...s.outputByShell, [shell.id]: "" },
          }));
        }
      }

      fit.fit();
      pushSize();
      term.focus();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [active, shell.id, pushSize]);

  // Best-effort fit after initial layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(id);
  }, []);

  // Flush a snapshot on unload / tab hide so a refresh has the freshest state.
  useEffect(() => {
    const onHide = () => flushPersist();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    // Keep ticking so a long-lived hidden terminal's tail is captured even when
    // not actually unfocused (safety net for state that never flushes).
    const interval = window.setInterval(() => {
      if (dirtyRef.current) persistSnapshot();
    }, 2000);

    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      window.clearInterval(interval);
    };
  }, [flushPersist, persistSnapshot]);

  return (
    <div
      className="h-full flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden"
      style={{ display: active ? undefined : "none" }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/70 text-xs text-zinc-400">
        <Terminal size={13} className="text-zinc-500" />
        <span className="truncate">{shell.name}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-zinc-600">{shell.status}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  );
}
