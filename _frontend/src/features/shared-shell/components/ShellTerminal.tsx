import { useCallback, useEffect, useRef } from "react";
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
 * Render a captured PTY buffer as clean, stable plain text for restore.
 *
 * The live stream already rendered correctly on screen; the problem is
 * *replaying* the whole raw buffer into a fresh xterm on navigate-back, which
 * re-runs every escape/control sequence and causes column drift, colour gaps
 * and stray blank lines. Instead we reduce the buffer to its visible plain-text
 * lines and write those, so a restored shell looks exactly like it did live
 * (geometry-stable, no colour/position jumps).
 */
function sanitizeRestore(raw: string): string {
  let s = raw
    // Erase display/line + cursor movement/home (relocates/clears the view).
    .replace(/\x1b\[[0-9?;]*[A-JK]/g, "")
    // DEC private-mode SET/RESET (bracketed paste ?2004h/l, alt-screen ?1049h,
    // etc.) — leaving these on would stick the fresh terminal in a weird mode.
    .replace(/\x1b\[\??[0-9;]*[hl]/g, "")
    // Cursor position / char-abs / scroll-region / modes — strip all CSI.
    .replace(/\x1b\[[0-9?;:]*[bcdfghlnst]/g, "")
    // SGR colour + all other CSI final-bytes (control noise; we want plain).
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    // OSC strings (title, hyperlink, shell-integration JSON) — strip wholesale.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Remaining ESC + control, DCS, APC, reset/charset.
    .replace(/\x1b[^a-zA-Z]*[A-Za-z]/g, "")
    .replace(/\x1b/g, "")
    // CRLF → LF (return-to-col-0 + advance), lone CR → LF.
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  // Collapse runs of blank lines to a single line break. Real transcripts
  // don't need multiple consecutive empty lines, and PTY control sequences
  // (bracketed-paste toggles, OSC hits) leave stray newlines behind — this
  // removes that noise so the restore matches the live render.
  return s.replace(/\n{2,}/g, "\n");
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
  // True until the authoritative transcript has been restored. The live store
  // subscriber holds back while this is set so the async restore and the WS
  // push cannot double-render the same bytes.
  const hydratePendingRef = useRef(true);

  // Explicitly forward the xterm's CURRENT geometry to the backend PTY. The PTY
  // is created at 80x24; if it stays there while the browser xterm is wider,
  // bash's line editor wraps input at 80 cols but the viewer shows more — so
  // typing past the wrap column starts overwriting earlier characters.
  const pushSize = useCallback(() => {
    const t = xtermRef.current;
    if (!t) return;
    const cols = t.cols;
    const rows = t.rows;
    if (cols > 0 && rows > 0) {
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
    }
  }, [shell.id]);

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

    // Push the post-fit geometry so the backend PTY matches the viewport from
    // the very first paint (avoids wrap/overwrite while typing).
    pushSize();

    // Keep course as the terminal viewport fits again on later lays-outs.
    const ro = new ResizeObserver(() => {
      fit.fit();
      pushSize();
    });
    ro.observe(el);


    // Forward keystrokes (including Ctrl+C/Ctrl+X which arrive as \x03/\x18
    // control bytes, and Ctrl+V paste content) to the backend PTY.
    const dataSub = term.onData((data) => {
      useSharedShellStore.getState().writeShell(shell.id, data).catch(() => {});
    });

    const writeBytes = (bytes: string) => {
      useSharedShellStore.getState().writeShell(shell.id, bytes).catch(() => {});
    };

    // Ensure Ctrl+C / Ctrl+V / Ctrl+X behave like a real terminal.
    //
    // xterm.js delegates copy/paste/control-key handling to the embedder:
    // returning `true` lets xterm process the key (Ctrl+C/Ctrl+X become the
    // \x03/\x18 control bytes on onData), returning `false` tells xterm to skip
    // it and hand off to the browser (which fires a native copy/paste event on
    // the focused textarea that xterm then re-emits as onData).
    //
    // So: Ctrl+V → return false so the browser's native paste runs (this is
    // why Ctrl+Shift+V already pastes); Ctrl+C / Ctrl+X → copy/cut when there
    // is a selection, otherwise let xterm send the interrupt/cancel byte.
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
        // Otherwise let xterm send the control byte to the shell. NOTE: for
        // reasons not yet diagnosed, Ctrl+X does not reliably fire here (the
        // browser often swallows it or it routes to "cut" regardless). Copy
        // (Ctrl+C) and paste (Ctrl+V) work; CTRL+X IS A KNOWN NON-WORKING CASE
        // — revisit later. Not urgent since copy/paste work.
        return true;
      }
      return true;
    });

    // Clicking anywhere gives xterm's textarea focus so keydown/native paste
    // events actually reach it.
    const onPointerDown = () => {
      term.focus();
    };
    el.addEventListener("pointerdown", onPointerDown);

    const resizeSub = term.onResize(({ cols, rows }) => {
      useSharedShellStore.getState().resizeShell(shell.id, cols, rows).catch(() => {});
    });

    // On shell switch (this xterm just mounted), the live WS stream only carried
    // output that arrived while this shell was mounted. The backend PTY holds the
    // authoritative full transcript — fetch and render it. We sanitize the replay
    // (clearing/erase codes would blank the fresh view), then hand back to live
    // output by draining the store buffered so no bytes are lost or doubled.
    let cancelled = false;
    (async () => {
      let output = "";
      try {
        const res = await getShellOutputApi(shell.id);
        output = res?.output ?? "";
      } catch {
        output = "";
      }
      if (cancelled) return;
      const live = xtermRef.current;
      if (!live) return;
      if (output) live.write(sanitizeRestore(output).replace(/\n/g, "\r\n"));
      // After rendering the authoritative buffer, release any bytes the live WS
      // push accumulated during the refetch, then hand control to the subscriber.
      const pending = useSharedShellStore.getState().outputByShell[shell.id];
      if (pending) {
        live.write(pending);
        useSharedShellStore.setState((s) => ({
          outputByShell: { ...s.outputByShell, [shell.id]: "" },
        }));
      }
      hydratePendingRef.current = false;
      // Ensure the backend PTY geometry matches the viewport after restore, and
      // restore focus so the user can type immediately (agent-created or not).
      pushSize();
      live.focus();
    })();

    return () => {
      cancelled = true;
      hydratePendingRef.current = true;
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

  // Live output push: subscribe to this shell's output buffer and write any new
  // deltas into xterm, then clear them. Held back while the authoritative
  // transcript is still being restored (hydratePendingRef) to avoid double-
  // rendering the same bytes.
  useEffect(() => {
    const unsub = useSharedShellStore.subscribe((state) => {
      const term = xtermRef.current;
      if (!term) return;
      if (hydratePendingRef.current) return;
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
