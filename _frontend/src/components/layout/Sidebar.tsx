import { useState, useCallback, useEffect, useRef } from "react";
import { TestingV3Tab } from "../../features/info-panel/components/testing-v3/TestingV3Tab";
import { useProximityPanel } from "../../hooks/useProximityPanel";
import { ProximityRail } from "./ProximityRail";
import { getAppInfo, runMasterTest, getMasterTestResult, type AppInfo, type MasterTestResult } from "../../lib/api";
import { FULL_VERSION } from "@shared/version";

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

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export function Sidebar({ search }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [masterTestResult, setMasterTestResult] = useState<MasterTestResult | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const testRunningRef = useRef(false);

  useEffect(() => {
    getAppInfo().then(setAppInfo).catch(() => {});
  }, []);

  // Load last master test result on mount
  useEffect(() => {
    getMasterTestResult().then(setMasterTestResult).catch(() => {});
  }, []);

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
        <div className="mt-auto px-3 py-2 text-[10px] text-zinc-600 select-none relative group/version flex items-center gap-1.5">
          <span>{appInfo?.version ? `${appInfo.version} (${import.meta.env.DEV ? "Dev" : "Prod"})` : FULL_VERSION}</span>
          {import.meta.env.DEV && (
            <button
              onClick={async () => {
                if (testRunningRef.current) return;
                testRunningRef.current = true;
                setTestRunning(true);
                setMasterTestResult(null);
                try {
                  // Capture baseline result timestamp BEFORE starting, so polling
                  // reliably detects when the new result arrives.  This avoids
                  // depending on the component state (which may be null or stale).
                  const before = await getMasterTestResult().catch(() => null);
                  const startedAt = before?.timestamp ?? null;
                  await runMasterTest();
                  for (let i = 0; i < 120; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    const res = await getMasterTestResult().catch(() => null);
                    if (res && res.timestamp !== startedAt && res.passed !== null) {
                      setMasterTestResult(res);
                      break;
                    }
                  }
                } catch { /* ignore */ }
                testRunningRef.current = false;
                setTestRunning(false);
              }}
              title="Run master e2e test (headed)"
              className="inline-flex items-center justify-center size-3.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2.5v11l10-5.5L3 2.5Z" fill="currentColor" stroke="none" />
                <path d="M3 2.5v11l10-5.5L3 2.5Z" />
              </svg>
            </button>
          )}
          {/* Master test result indicator — always visible, dev or prod */}
          {masterTestResult?.passed === true && (
            <span
              title={`Master test passed at ${formatDateTime(masterTestResult.timestamp!)}`}
              className="text-green-400 select-none"
              style={{ fontSize: "7px", lineHeight: "1" }}
            >✓</span>
          )}
          {masterTestResult?.passed === false && (
            <span
              title={`Master test failed at ${formatDateTime(masterTestResult.timestamp!)} (exit code ${masterTestResult.exitCode})`}
              className="text-red-400 select-none"
              style={{ fontSize: "7px", lineHeight: "1" }}
            >✕</span>
          )}
          {testRunning && masterTestResult === null && (
            <span
              title="Test running…"
              className="text-zinc-500 select-none animate-pulse"
              style={{ fontSize: "7px", lineHeight: "1" }}
            >◉</span>
          )}
          <div className="hidden group-hover/version:block absolute bottom-full left-0 mb-1 z-50 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[10px] text-zinc-300 whitespace-nowrap shadow-lg pointer-events-none">
            {import.meta.env.DEV ? (
              <>
                <div>Dev</div>
                <div>Version: {FULL_VERSION}</div>
              </>
            ) : appInfo?.installedAt ? (
              <>
                {appInfo?.version && (
                  <div>Version: {appInfo.version}</div>
                )}
                {appInfo?.buildTimestamp && (
                  <div>Packed: {formatDateTime(appInfo.buildTimestamp)}</div>
                )}
                <div>Installed: {formatDateTime(appInfo.installedAt)}</div>
              </>
            ) : (
              <>
                {appInfo?.version && (
                  <div>Version: {appInfo.version}</div>
                )}
                <div>Prod (Unpackaged)</div>
              </>
            )}
          </div>
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
