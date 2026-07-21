import { useState, useCallback, useEffect, useRef } from "react";
import { TestingV3Tab } from "../../features/info-panel/components/testing-v3/TestingV3Tab";
import { useProximityPanel } from "../../hooks/useProximityPanel";
import { ProximityRail } from "./ProximityRail";

interface SidebarProps {
  search: string;
}

const MIN_W = 160;
const MAX_W = 480;
const DEFAULT_W = 192;
const WIDTH_KEY = "visual-studio-harness:sidebarWidth";

function loadSidebarWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.max(MIN_W, Math.min(MAX_W, n));
    }
  } catch { /* ignore */ }
  return DEFAULT_W;
}

export function Sidebar({ search }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);

  const panel = useProximityPanel({
    side: "left",
    width: sidebarWidth,
    toggleShortcut: "sidebar.toggle",
    pinShortcut: "sidebar.pin",
  });

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(sidebarWidth)); }
    catch { /* ignore */ }
  }, [sidebarWidth]);

  useEffect(() => {
    if (resizing) panel.pin();
  }, [resizing, panel]);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      setResizing(true);
      panel.pin();

      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        setSidebarWidth(Math.max(MIN_W, Math.min(MAX_W, ev.clientX)));
      };

      const onUp = () => {
        resizingRef.current = false;
        setResizing(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panel],
  );

  return (
    <div className="relative h-full flex shrink-0">
      <ProximityRail
        panel={panel}
        contentWidth={sidebarWidth}
        noTransition={resizing}
        pinTestId="sidebar-pin"
        pinTitle={{ pinned: "Unpin sidebar", unpinned: "Pin sidebar open" }}
      >
        <TestingV3Tab search={search} />
        <div className="mt-auto px-3 py-2 text-[10px] text-zinc-600 select-none">
          0.0.1-alpha (Pre-Release)
        </div>
      </ProximityRail>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize"
        className={`absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-ew-resize z-30 group ${
          resizing ? "bg-zinc-500/40" : "hover:bg-zinc-600/40"
        }`}
        onMouseDown={onHandleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-700/0 group-hover:bg-zinc-500/60 transition-colors" />
      </div>
    </div>
  );
}
