import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useSharedShellStore } from "../store";
import { getShellOutputApi } from "../api";
import type { Shell } from "../types";

interface ShellTerminalProps {
  shell: Shell;
}

/**
 * Real interactive terminal rendered with xterm.js, mirroring VSCode's
 * integrated terminal. Backend PTY output is written into the xterm buffer;
 * keystrokes are forwarded back to the PTY so colours, job control and
 * full-screen apps behave natively. Mounted per shell via a `key` so each shell
 * owns a single xterm instance.
 */
export function ShellTerminal({ shell }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Initialise xterm once per shell mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || xtermRef.current) return;

    const term = new Xterm({
      fontSize: 13,
      fontFamily: "JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace",
      cursorBlink: true,
      theme: { background: "#0e0e11" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    term.focus();

    xtermRef.current = term;
    fitRef.current = fit;

    // Forward keystrokes and resize events to the backend PTY.
    const dataSub = term.onData((data) => {
      useSharedShellStore.getState().writeShell(shell.id, data).catch(() => {});
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
    });

    // On shell switch (this xterm just mounted), the live WS stream only carried
    // output that arrived while this shell was displayed. The backend PTY holds
    // the authoritative full transcript — fetch and render it. Also clear the
    // store buffer for this shell so the live subscription doesn't re-write the
    // same bytes (store and backend buffers mirror each other).
    setTimeout(() => {
      getShellOutputApi(shell.id)
        .then(({ output }) => {
          if (!output) return;
          const live = xtermRef.current;
          if (live) live.write(output);
        })
        .catch(() => {});
    }, 0);
    useSharedShellStore.setState((s) => {
      if (!s.outputByShell[shell.id]) return s;
      return { outputByShell: { ...s.outputByShell, [shell.id]: "" } };
    });

    return () => {
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.id]);

  // Live output push: subscribe to this shell's output buffer and write any new
  // deltas into xterm, then clear them.
  useEffect(() => {
    const unsub = useSharedShellStore.subscribe((state) => {
      const term = xtermRef.current;
      if (!term) return;
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

  // Best-effort fit after initial layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="h-full flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
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
