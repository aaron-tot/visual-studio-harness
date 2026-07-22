import { useState, useCallback, useEffect, useRef } from "react";
import { useProximityPanel } from "../../../hooks/useProximityPanel";
import { ProximityRail } from "../../../components/layout/ProximityRail";
import type { InfoPanelTab } from "../types";
import { TabButton, EmptyState } from "./ui";
import { UsageV2Tab } from "./usage-v2";
import { IdeasTab } from "./ideas/IdeasTab";

const MIN_W = 200;
const MAX_W = 640;
const DEFAULT_W = 280;
const WIDTH_KEY = "visual-studio-harness:infoPanelWidth";

function loadPanelWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.max(MIN_W, Math.min(MAX_W, n));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_W;
}

export function InfoPanel() {
  const [tab, setTab] = useState<InfoPanelTab>("usage");
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);

  const panel = useProximityPanel({
    side: "right",
    width: panelWidth,
    toggleShortcut: "infoPanel.toggle",
    pinShortcut: "infoPanel.pin",
  });

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  useEffect(() => {
    if (resizing) panel.pin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing]);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      setResizing(true);
      panel.pin();

      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const w = window.innerWidth - ev.clientX;
        setPanelWidth(Math.max(MIN_W, Math.min(MAX_W, w)));
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
    [panel]
  );

  return (
    <div className="relative h-full flex shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize info panel"
        title="Drag to resize"
        className={`absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize z-30 group ${
          resizing ? "bg-zinc-500/40" : "hover:bg-zinc-600/40"
        }`}
        onMouseDown={onHandleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-700/0 group-hover:bg-zinc-500/60 transition-colors" />
      </div>
      <ProximityRail
        panel={panel}
        contentWidth={panelWidth}
        noTransition={resizing}
        pinTitle={{ pinned: "Unpin panel", unpinned: "Pin panel open" }}
        headerStart={
          <div className="flex gap-1 flex-wrap">
            <TabButton active={tab === "usage"} onClick={() => setTab("usage")}>
              Usage
            </TabButton>
            <TabButton active={tab === "ideas"} onClick={() => setTab("ideas")}>
              Ideas
            </TabButton>
            <TabButton active={tab === "resources"} onClick={() => setTab("resources")}>
              Resources
            </TabButton>
            <TabButton active={tab === "research"} onClick={() => setTab("research")}>
              Research
            </TabButton>
          </div>
        }
      >
        {tab === "usage" ? (
          <UsageV2Tab />
        ) : tab === "ideas" ? (
          <IdeasTab active={panel.isOpen} />
        ) : (
          <EmptyState>Coming soon</EmptyState>
        )}
      </ProximityRail>
    </div>
  );
}
