import { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronDown,
  Terminal,
  GripHorizontal,
  GripVertical,
  Plus,
} from "lucide-react";
import { ShellList } from "../../features/shared-shell/components/ShellList";
import { ShellTerminal } from "../../features/shared-shell/components/ShellTerminal";
import { useSharedShellStore, initSharedShellWs } from "../../features/shared-shell/store";

interface SessionPanelProps {
  /** Active session id. Sizes are persisted per session in localStorage. */
  sessionId: string | null;
  /** Reports the space the expanded panel occupies so the parent can keep the
   *  message scroll area from being overlapped. Passes 0 when collapsed. */
  onHeightChange?: (height: number) => void;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.6;

/** Width of the right-side sub-panel. */
const DEFAULT_SUBPANEL_WIDTH = 200;
const MIN_SUBPANEL_WIDTH = 140;
const MAX_SUBPANEL_WIDTH = 480;

/** Height of the fixed chrome: drag handle + header toggle. */
const CHROME_HEIGHT = 40;

function heightKey(sessionId: string): string {
  return `VISUAL STUDIO HARNESS.sessionPanelHeight.${sessionId}`;
}
function widthKey(sessionId: string): string {
  return `VISUAL STUDIO HARNESS.sessionPanelWidth.${sessionId}`;
}
function openKey(sessionId: string): string {
  return `VISUAL STUDIO HARNESS.sessionPanelOpen.${sessionId}`;
}

/** Bottom-anchored panel docked 16px from the viewport bottom (see NewChat). */
const BOTTOM_OFFSET = 16;

function loadHeight(sessionId: string): number {
  const saved = Number(localStorage.getItem(heightKey(sessionId)));
  return Number.isFinite(saved) && saved >= MIN_HEIGHT ? Math.round(saved) : MIN_HEIGHT;
}

function loadWidth(sessionId: string): number {
  const saved = Number(localStorage.getItem(widthKey(sessionId)));
  return Number.isFinite(saved) && saved >= MIN_SUBPANEL_WIDTH
    ? Math.round(saved)
    : DEFAULT_SUBPANEL_WIDTH;
}

function loadOpen(sessionId: string): boolean {
  return localStorage.getItem(openKey(sessionId)) === "1";
}

function save(key: string, value: string | number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Collapsible, drag-resizable panel that lives immediately below the chat user
 * input, sharing the input card's width (a two-row stack). Session-view only —
 * not rendered on the new-chat page. Expanded height is adjustable via a drag
 * handle at the panel's top boundary. The expanded body contains a right-side
 * sub-panel whose width is adjustable via a vertical handle. Both sizes are
 * persisted per session.
 */
export function SessionPanel({ sessionId, onHeightChange }: SessionPanelProps) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(() => (sessionId ? loadHeight(sessionId) : MIN_HEIGHT));
  const [subWidth, setSubWidth] = useState(() => (sessionId ? loadWidth(sessionId) : DEFAULT_SUBPANEL_WIDTH));
  const draggingRef = useRef(false);
  const resizingWidthRef = useRef(false);
  // Keep live values during drag, read by the mouseup handler so it saves the final
  // (post-drag) size rather than the captured render-time value.
  const liveHeightRef = useRef(height);
  const liveWidthRef = useRef(subWidth);

  // Ensure shared-shell WS handlers are registered (idempotent, app-wide once).
  useEffect(() => {
    initSharedShellWs();
  }, []);

  // Restore per-session saved sizes on any session change (mount, switch, refresh).
  // Kept in the same render cycle so a state change session id keeps its own layout.
  const prevSessionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (sessionId === prevSessionRef.current) return;
    prevSessionRef.current = sessionId;
    if (!sessionId) {
      setOpen(false);
      return;
    }
    const h = loadHeight(sessionId);
    const w = loadWidth(sessionId);
    liveHeightRef.current = h;
    liveWidthRef.current = w;
    setHeight(h);
    setSubWidth(w);
    setOpen(loadOpen(sessionId));
  }, [sessionId]);

  // Persist sizes + open state to localStorage whenever they change, so they survive
  // page refreshes and app restarts (not just session switches).
  useEffect(() => {
    if (!sessionId) return;
    save(heightKey(sessionId), height);
  }, [sessionId, height]);
  useEffect(() => {
    if (!sessionId) return;
    save(widthKey(sessionId), subWidth);
  }, [sessionId, subWidth]);
  useEffect(() => {
    if (!sessionId) return;
    save(openKey(sessionId), open ? "1" : "0");
  }, [sessionId, open]);

  const shellRecord = useSharedShellStore((s) => s.bySession);
  const activeRecord = useSharedShellStore((s) => s.activeBySession);
  const createShell = useSharedShellStore((s) => s.createShell);
  const closeShell = useSharedShellStore((s) => s.closeShell);
  const selectShell = useSharedShellStore((s) => s.selectShell);
  const listShells = useSharedShellStore((s) => s.listShells);
  const resetSession = useSharedShellStore((s) => s.resetSession);
  const shells = sessionId ? shellRecord[sessionId] ?? [] : [];
  const activeShellId = sessionId ? activeRecord[sessionId] ?? null : null;
  const activeShell = shells.find((sh) => sh.id === activeShellId) ?? shells[shells.length - 1];

  // On session switch: reset display state for the new session and fetch its
  // shells (if any are still running on the backend).
  useEffect(() => {
    if (!sessionId) return;
    resetSession(sessionId);
    listShells(sessionId).catch(() => {});
  }, [sessionId, resetSession, listShells]);

  const clampHeight = useCallback((value: number) => {
    const max = window.innerHeight * MAX_HEIGHT_RATIO;
    return Math.round(Math.min(Math.max(value, MIN_HEIGHT), max));
  }, []);

  const clampWidth = useCallback((value: number) => {
    return Math.round(Math.min(Math.max(value, MIN_SUBPANEL_WIDTH), MAX_SUBPANEL_WIDTH));
  }, []);

  // Bottom-anchored: panel top sits at (viewportBottom - BOTTOM_OFFSET - height).
  const beginHeightDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const next = clampHeight(window.innerHeight - BOTTOM_OFFSET - ev.clientY);
        liveHeightRef.current = next;
        setHeight(next);
      };
      const onUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clampHeight]
  );

  // Right-side sub-panel width drag (vertical handle): drag left/right.
  const beginWidthDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingWidthRef.current = true;
      // The handle sits on the sub-panel's left edge; panel left is fixed, so
      // width = (sub-panel right) - clientX. Use the container's right boundary.
      const container = document.getElementById("session-panel-body");
      const onMove = (ev: MouseEvent) => {
        if (!resizingWidthRef.current || !container) return;
        const containerRight = container.getBoundingClientRect().right;
        const next = clampWidth(containerRight - ev.clientX);
        liveWidthRef.current = next;
        setSubWidth(next);
      };
      const onUp = () => {
        resizingWidthRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clampWidth]
  );

  // Report the space the panel occupies (0 when collapsed).
  useEffect(() => {
    onHeightChange?.(open ? height : 0);
  }, [open, height, onHeightChange]);

  // Keep live refs in sync whenever height/width change outside a drag.
  useEffect(() => {
    liveHeightRef.current = height;
  }, [height]);
  useEffect(() => {
    liveWidthRef.current = subWidth;
  }, [subWidth]);

  const bodyHeight = Math.max(height - CHROME_HEIGHT, 0);

  return (
    <div className="w-full rounded-xl border border-zinc-700/20 bg-zinc-950/80 overflow-hidden">
      {/* Drag-resize handle (top boundary between input and panel) */}
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          onMouseDown={beginHeightDrag}
          className="h-1.5 flex items-center justify-center cursor-ns-resize select-none group/drag"
          title="Drag to resize height"
        >
          <GripHorizontal size={12} className="text-zinc-600 group-hover/drag:text-zinc-400" />
        </div>
      )}

      {/* Header: toggle + plus button on the right */}
      <div className="w-full flex items-center gap-2 px-3 py-2 select-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={open}
        >
          <Terminal size={14} className="text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400">Session panel</span>
          <span className="flex-1" />
          <ChevronDown
            size={14}
            className={`text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!sessionId) return;
            createShell(sessionId).catch((err) => console.error("Failed to create shell:", err));
          }}
          className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Add shell"
          aria-label="Add shell"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Collapsible/resizable body */}
      <div className="grid" style={{ gridTemplateRows: open ? `${bodyHeight}px` : "0fr" }}>
        <div className="overflow-hidden min-h-0">
          <div id="session-panel-body" className="flex h-full px-3 pb-2">
            {/* Left: active shell for this session */}
            <div className="flex-1 min-w-0 min-h-0">
              {activeShell ? (
                <ShellTerminal key={activeShell.id} shell={activeShell} />
              ) : (
                <div className="h-full rounded-lg border border-dashed border-zinc-800 flex items-center justify-center text-xs text-zinc-600">
                  No shells — press + to create one
                </div>
              )}
            </div>

            {/* Vertical drag handle for the sub-panel width */}
            {open && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={beginWidthDrag}
                className="w-1.5 mx-1 flex items-center justify-center cursor-ew-resize select-none self-stretch group/dragwle"
                title="Drag to resize side panel"
              >
                <GripVertical size={12} className="text-zinc-600 group-hover/dragwle:text-zinc-400" />
              </div>
            )}

            {/* Right-side sub-panel: shell list for this session */}
            <div
              className="shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-y-auto"
              style={{ width: subWidth, minHeight: 0 }}
            >
              <div className="p-1.5">
                {shells.length > 0 && (
                  <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
                    Shells
                  </div>
                )}
                <ShellList
                  shells={shells}
                  activeShellId={activeShell?.id ?? null}
                  onSelect={(shellId) => { if (sessionId) selectShell(sessionId, shellId); }}
                  onClose={(shellId) => {
                    if (sessionId) closeShell(sessionId, shellId).catch((err) => console.error("Failed to close shell:", err));
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
