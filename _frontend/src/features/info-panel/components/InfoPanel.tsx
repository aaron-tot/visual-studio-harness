import { useState, useCallback, useEffect, useRef } from "react";
import { useProximityPanel } from "../../../hooks/useProximityPanel";
import { ProximityRail } from "../../../components/layout/ProximityRail";
import type { InfoPanelTab, PlanScope } from "../types";
import { TabButton, EmptyState } from "./ui";
import { ScopePicker } from "./ScopePicker";
import { UsageV2Tab } from "./usage-v2";
import { IdeasTab } from "./ideas/IdeasTab";
import { NotesTab } from "./notes/NotesTab";
import { GraphTab } from "./GraphTab/GraphTab";
import { AuditsTab } from "./audits/AuditsTab";
import { ResearchTab } from "./research/ResearchTab";
import { KnowledgeTab } from "../../knowledge-base";

/** Canonical tab order — same on every scope; filtered by visibility set. */
const ALL_TABS: InfoPanelTab[] = ["designs", "notepad", "audits", "research", "knowledge", "usage", "graph"];

/** Which tabs are visible per scope. */
const SCOPE_TABS: Record<PlanScope, Set<InfoPanelTab>> = {
  global: new Set(["designs", "notepad", "audits", "research", "knowledge"]),
  project: new Set(["designs", "notepad", "audits", "research", "knowledge", "graph"]),
  session: new Set(["usage", "designs", "notepad", "audits", "research", "knowledge"]),
};

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
  const [scope, setScope] = useState<PlanScope>("global");
  const visibleTabs = ALL_TABS.filter((t) => SCOPE_TABS[scope].has(t));
  const [tab, setTab] = useState<InfoPanelTab>(visibleTabs[0]);
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);

  // Auto-switch tab if current tab is hidden by scope change
  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(visibleTabs[0]);
    }
  }, [scope, tab, visibleTabs]);

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
        className={`hidden lg:block absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize z-30 group ${
          resizing ? "bg-zinc-500/40" : "hover:bg-zinc-600/40"
        }`}
        onMouseDown={onHandleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-700/0 group-hover:bg-zinc-500/60 transition-colors" />
      </div>
      <ProximityRail
        panel={panel}
        side="right"
        contentWidth={panelWidth}
        noTransition={resizing}
        pinTitle={{ pinned: "Unpin panel", unpinned: "Pin panel open" }}
        headerStart={
          <div className="flex items-center min-w-0 flex-1">
            <ScopePicker scope={scope} onChange={setScope} />
          </div>
        }
      >
        <div className="flex gap-1 flex-wrap px-3 pt-2 pb-1 shrink-0 border-b border-zinc-800/50">
          {visibleTabs.map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
              {t === "usage"
                ? "Usage"
                : t === "designs"
                  ? "Designs"
                  : t === "notepad"
                    ? "Notepad"
                    : t === "audits"
                      ? "Audits"
                      : t === "research"
                        ? "Research"
                        : t === "knowledge"
                          ? "Knowledge"
                          : t === "graph"
                            ? "Graph"
                            : t}
            </TabButton>
          ))}
        </div>
        {tab === "usage" ? (
          <UsageV2Tab />
        ) : tab === "designs" ? (
          <IdeasTab active={panel.isOpen} scope={scope} />
        ) : tab === "notepad" ? (
          <NotesTab active={panel.isOpen} scope={scope} />
        ) : tab === "audits" ? (
          <AuditsTab active={panel.isOpen} scope={scope} />
        ) : tab === "research" ? (
          <ResearchTab active={panel.isOpen} scope={scope} />
        ) : tab === "graph" ? (
          <GraphTab />
        ) : tab === "knowledge" ? (
          <KnowledgeTab scope={scope} />
        ) : (
          <EmptyState>Coming soon</EmptyState>
        )}
      </ProximityRail>
    </div>
  );
}
