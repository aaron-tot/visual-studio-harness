import { useCallback, useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useSharedShellStore } from "../store";
import { getShellSnapshotApi } from "../api";
import { SHELL_THEME } from "../theme";
import type { Shell, ShellSnapshot } from "../types";

interface ShellTerminalProps {
  shell: Shell;
  /** Hidden shells keep their xterm; only the active one is shown. */
  active?: boolean;
}

function writeDone(term: Xterm, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, () => resolve());
  });
}

/** Interactive xterm. Refresh hydrates from the PTY-host headless snapshot. */
export function ShellTerminal({ shell, active = false }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hydratedRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const pushSize = useCallback(() => {
    const t = xtermRef.current;
    if (!t) return;
    if (t.cols > 0 && t.rows > 0) {
      useSharedShellStore.getState().resizeShell(shell.id, t.cols, t.rows).catch(() => {});
    }
  }, [shell.id]);

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
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);

    xtermRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      if (!activeRef.current) return;
      fit.fit();
      pushSize();
    });
    ro.observe(el);

    const dataSub = term.onData((data) => {
      useSharedShellStore.getState().writeShell(shell.id, data).catch(() => {});
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return true;
      const key = e.key.toLowerCase();
      if (key === "v") return false;
      if ((key === "c" || key === "x") && term.hasSelection()) return false;
      return true;
    });

    const onPointerDown = () => {
      term.focus();
    };
    el.addEventListener("pointerdown", onPointerDown);

    const resizeSub = term.onResize(({ cols, rows }) => {
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
    });

    return () => {
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.id]);

  useEffect(() => {
    const unsub = useSharedShellStore.subscribe((state) => {
      const term = xtermRef.current;
      if (!term || !hydratedRef.current) return;
      const data = state.outputByShell[shell.id];
      if (!data) return;
      term.write(data);
      useSharedShellStore.setState((s) => ({
        outputByShell: { ...s.outputByShell, [shell.id]: "" },
      }));
    });
    return () => {
      unsub();
    };
  }, [shell.id]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const id = requestAnimationFrame(async () => {
      const term = xtermRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;

      if (!hydratedRef.current) {
        let snapshot: ShellSnapshot | null = null;
        try {
          const res = await getShellSnapshotApi(shell.id);
          snapshot = res?.snapshot ?? null;
        } catch {
          snapshot = null;
        }
        if (cancelled) return;

        if (snapshot && snapshot.serialized && snapshot.cols > 0 && snapshot.rows > 0) {
          term.resize(snapshot.cols, snapshot.rows);
          await writeDone(term, snapshot.serialized);
        }
        if (cancelled) return;

        hydratedRef.current = true;
        const pending = useSharedShellStore.getState().outputByShell[shell.id];
        if (pending) {
          await writeDone(term, pending);
          useSharedShellStore.setState((s) => ({
            outputByShell: { ...s.outputByShell, [shell.id]: "" },
          }));
        }
      }
      if (cancelled) return;
      fit.fit();
      pushSize();
      term.focus();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [active, shell.id, pushSize]);

  useEffect(() => {
    const id = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(id);
  }, []);

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
