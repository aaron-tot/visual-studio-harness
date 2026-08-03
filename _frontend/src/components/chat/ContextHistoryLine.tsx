import { useEffect, useRef, useCallback, useState } from "react";
import { putSessionContextConfig, getEffectiveContextConfig } from "../../lib/api";
import { useChatStore } from "../../stores/chat";

/**
 * Vertical history line rendered alongside chat messages.
 * Shows which turns are included in LLM context (colored portion).
 * User can drag the handle to include/exclude turns from history.
 * Handle snaps to user message (turn) boundaries.
 */
export function ContextHistoryLine({
  sessionId,
  scrollRef,
  messageCount,
}: {
  sessionId: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messageCount: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [firstTurnNumber, setFirstTurnNumber] = useState<number | null>(null);
  const [contextMode, setContextMode] = useState<"auto" | "manual">("manual");
  const [contextMaxTurns, setContextMaxTurns] = useState(10);
  const [contextOwner, setContextOwner] = useState<"session" | "project" | "global" | "none">("none");
  const [pinned, setPinned] = useState(false); // manual mode: pinned to specific turn
  const [manualTurnsBack, setManualTurnsBack] = useState(10); // unpinned: N turns back from end
  const [dragging, setDragging] = useState(false);
  const [dragClientY, setDragClientY] = useState(0);

  // Turn Y positions (scroll-dependent — recalculated on every scroll)
  const [turnPositions, setTurnPositions] = useState<{ number: number; y: number }[]>([]);
  // Bottom of the last message (scroll-stable — only recalculated on mutation)
  const [lineBottom, setLineBottom] = useState(0);

  const measure = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const containerRect = sc.getBoundingClientRect();
    const scrollTop = sc.scrollTop;

    // Turn positions — one per turn (dedupe: both user & assistant of the
    // same turn carry data-turn-number, so keep the topmost = turn start)
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turnMap = new Map<number, number>();
    turnEls.forEach((msgEl) => {
      const tn = parseInt(msgEl.dataset.turnNumber || "0", 10);
      if (!tn) return;
      const rect = msgEl.getBoundingClientRect();
      const y = rect.top - containerRect.top + scrollTop;
      const existing = turnMap.get(tn);
      if (existing === undefined || y < existing) turnMap.set(tn, y);
    });
    const turns: { number: number; y: number }[] = [];
    turnMap.forEach((y, number) => turns.push({ number, y }));
    turns.sort((a, b) => a.number - b.number);
    setTurnPositions(turns);
  }, [scrollRef]);

  /** Full remeasure — also recalculates the bottom of the last message. */
  const fullMeasure = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const containerRect = sc.getBoundingClientRect();
    const scrollTop = sc.scrollTop;

    // Turn positions — one per turn (dedupe: both user & assistant of the
    // same turn carry data-turn-number, so keep the topmost = turn start)
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turnMap = new Map<number, number>();
    turnEls.forEach((msgEl) => {
      const tn = parseInt(msgEl.dataset.turnNumber || "0", 10);
      if (!tn) return;
      const rect = msgEl.getBoundingClientRect();
      const y = rect.top - containerRect.top + scrollTop;
      const existing = turnMap.get(tn);
      if (existing === undefined || y < existing) turnMap.set(tn, y);
    });
    const turns: { number: number; y: number }[] = [];
    turnMap.forEach((y, number) => turns.push({ number, y }));
    turns.sort((a, b) => a.number - b.number);
    setTurnPositions(turns);

    // Bottom of the last message row — use offsetTop for scroll-stability
    const allMsgs = sc.querySelectorAll<HTMLElement>(
      "[data-user-msg], [data-assistant-msg]",
    );
    let bottom = 0;
    allMsgs.forEach((r) => {
      const b = r.offsetTop + r.offsetHeight;
      if (b > bottom) bottom = b;
    });
    if (bottom > 0) setLineBottom(bottom);
  }, [scrollRef]);

  // Scroll → update positions only (bottom stays fixed)
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const handler = () => requestAnimationFrame(measure);
    sc.addEventListener("scroll", handler, { passive: true });
    return () => sc.removeEventListener("scroll", handler);
  }, [measure, scrollRef]);

  // Mount + mutation → full remeasure
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    fullMeasure();
    const observer = new MutationObserver(() => requestAnimationFrame(fullMeasure));
    observer.observe(sc, { childList: true, subtree: true });
    window.addEventListener("resize", fullMeasure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fullMeasure);
    };
  }, [fullMeasure, sessionId, scrollRef]);

  // Message count change → full remeasure (catches async loads)
  useEffect(() => {
    if (scrollRef.current) fullMeasure();
  }, [messageCount, fullMeasure, scrollRef]);

  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const setStoreCtxMode = useChatStore((s) => s.setContextConfigMode);
  const setStoreCtxMaxTurns = useChatStore((s) => s.setContextConfigMaxTurns);

// Sync store value immediately when local firstTurnNumber changes
  const setStoreCtxTn = useChatStore((s) => s.setContextFirstTurnNumber);
  useEffect(() => {
    if (!sessionId) return;
setStoreCtxTn(firstTurnNumber);
  }, [firstTurnNumber, sessionId, setStoreCtxTn]);

  // ── Manual mode: pinned = fixed to specific turn, unpinned = N turns back ──────
  useEffect(() => {
    // pinned isn't a dep on purpose: pinning/unpinning must NOT move the
    // handle. Only a change in manualTurnsBack or turnPositions recomputes.
    if (contextMode !== "manual" || turnPositions.length === 0) return;
    if (pinned) return; // pinned: keep handle where it is
    const numbers = turnPositions.map((t) => t.number).sort((a, b) => a - b);
    const lastTurn = numbers[numbers.length - 1];
    let firstTn: number | null;
    if (manualTurnsBack === -1) {
      firstTn = null;
    } else if (manualTurnsBack === 0) {
      firstTn = lastTurn + 1;
    } else {
      const idx = numbers.length - manualTurnsBack - 1;
      const tn = idx >= 0 ? numbers[Math.min(idx, numbers.length - 1)] : numbers[0];
      firstTn = tn > numbers[0] ? tn : null;
    }
    setFirstTurnNumber(firstTn);
    setStoreCtxTn(firstTn);
  }, [manualTurnsBack, turnPositions]);

  // ── Auto-mode: recompute firstTurnNumber from maxTurns ────────────
  useEffect(() => {
    if (contextMode !== "auto" || turnPositions.length === 0) return;
    const numbers = turnPositions.map((t) => t.number).sort((a, b) => a - b);
    const lastTurn = numbers[numbers.length - 1];
    let firstTn: number | null;
    if (contextMaxTurns === -1) {
      firstTn = null; // all turns (no filtering)
    } else if (contextMaxTurns === 0) {
      firstTn = lastTurn + 1; // no turns (beyond last turn)
    } else {
      // "N turns" = N previous completed turns + current (N+1 total)
      // firstTurnNumber = the (N)-th previous completed turn from the end
      // i.e., index = length - N - 1 (skip the current streaming turn)
      const idx = numbers.length - contextMaxTurns - 1;
      const tn = idx >= 0 ? numbers[Math.min(idx, numbers.length - 1)] : numbers[0];
      firstTn = tn > numbers[0] ? tn : null;
    }
    setFirstTurnNumber(firstTn);
    // Immediate sync to store so sendMessage sees the value without extra render cycle
    setStoreCtxTn(firstTn);
    setStoreCtxMode(contextMode);
    setStoreCtxMaxTurns(contextMaxTurns);
  }, [contextMode, contextMaxTurns, turnPositions]);

  // Re-load when store version bumps (ContextPanel saves)
  const ctxCfgVersion = useChatStore((s) => s.contextConfigVersion);

  // ── Load context config (also reads mode/maxTurns) ────────────────
  useEffect(() => {
    if (!sessionId) return;
    getEffectiveContextConfig(sessionId, workspaceRoot || undefined)
      .then((c) => {
        setFirstTurnNumber(c.firstTurnNumber);
        setContextMode(c.mode ?? "manual");
        setContextMaxTurns(c.maxTurns ?? 10);
        setContextOwner(c.owner ?? "none");
        // Sync to store so sendMessage always has the effective config
        setStoreCtxMode(c.mode ?? "manual");
        setStoreCtxMaxTurns(c.maxTurns ?? 10);
      })
      .catch(() => {});
  }, [sessionId, ctxCfgVersion, workspaceRoot]);

  // Find snap target from cursor Y using midpoints between turn positions
  const getSnapTurn = useCallback(
    (clientY: number): number | null => {
      const sc = scrollRef.current;
      if (!sc || turnPositions.length === 0) return null;
      const containerRect = sc.getBoundingClientRect();
      const cursorY = clientY - containerRect.top + sc.scrollTop;

      // Walk turn positions and find which region the cursor falls into.
      // The boundary between two adjacent turns is their midpoint.
      for (let i = 0; i < turnPositions.length; i++) {
        const currentY = turnPositions[i].y;
        const prevBoundary =
          i > 0 ? (turnPositions[i - 1].y + currentY) / 2 : -Infinity;
        const nextBoundary =
          i < turnPositions.length - 1
            ? (currentY + turnPositions[i + 1].y) / 2
            : Infinity;

        if (cursorY >= prevBoundary && cursorY < nextBoundary) {
          return turnPositions[i].number;
        }
      }
      return turnPositions[0].number;
    },
    [turnPositions, scrollRef],
  );

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      // Track raw cursor for free-floating handle (no snap until release)
      setDragClientY(e.clientY);
    },
    [dragging],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setDragging(false);
      const snap = getSnapTurn(e.clientY);
      if (snap == null || !sessionId) return;
      const minTurn = turnPositions.length > 0 ? turnPositions[0].number : 1;
      const value = snap <= minTurn ? null : snap;
      // Switch to manual mode (user explicitly adjusted)
      setContextMode("manual");
      setFirstTurnNumber(value);
      setPinned(true); // pin to this specific turn
      putSessionContextConfig(sessionId, { firstTurnNumber: value, mode: "manual" }).catch(() => {});
    },
    [getSnapTurn, sessionId, turnPositions],
  );

  const togglePin = useCallback(() => {
    setPinned(prev => !prev);
  }, []);

  // Handle Y in scroll-container-relative coords
  let handleY: number | null = null;
  if (turnPositions.length > 0) {
    if (dragging) {
      // During drag: raw cursor position (free, no snap)
      const sc = scrollRef.current;
      if (sc) {
        const containerRect = sc.getBoundingClientRect();
        handleY = dragClientY - containerRect.top + sc.scrollTop;
      }
    } else if (firstTurnNumber == null) {
      handleY = turnPositions[0].y;
    } else {
      const found = turnPositions.find((t) => t.number === firstTurnNumber);
      handleY = found?.y ?? turnPositions[0].y;
    }
  }

  // Convert scroll-container-relative Y to viewport-relative Y for rendering
  // so the handle tracks with scroll position
  const sc = scrollRef.current;
  const visibleHandleY =
    handleY != null && sc ? handleY - sc.scrollTop : null;

  const visibleLineBottom = lineBottom > 0 && sc ? lineBottom - sc.scrollTop : 0;

  const barH = sc ? sc.getBoundingClientRect().height : 0;

  // ── Snap direction during drag ─────────────────────────────────────
  let snapAbove = true;
  if (dragging && sc) {
    const snapTn = getSnapTurn(dragClientY);
    if (snapTn != null) {
      const found = turnPositions.find((t) => t.number === snapTn);
      if (found) {
        const rawHandleY = dragClientY - sc.getBoundingClientRect().top + sc.scrollTop;
        snapAbove = found.y <= rawHandleY;
      }
    }
  }

  // ── Tooltip label: scope : mode : turn count ───────────────────────
  const ownerLabel =
    contextOwner === "session" ? "Session"
    : contextOwner === "project" ? "Project"
    : contextOwner === "global" ? "Global"
    : "Default";
  const totalTurnsNow = turnPositions.length;
  let turnsLabel: string;
  if (contextMode === "auto") {
    if (contextMaxTurns === -1) turnsLabel = "All turns";
    else if (contextMaxTurns === 0) turnsLabel = "None";
    else turnsLabel = `${contextMaxTurns} turn${contextMaxTurns === 1 ? "" : "s"}`;
  } else {
    // Manual: count drives from firstTurnNumber to end (or all if null)
    if (firstTurnNumber == null) turnsLabel = "All turns";
    else turnsLabel = `${Math.max(0, totalTurnsNow - firstTurnNumber + 1)} turn${totalTurnsNow - firstTurnNumber + 1 === 1 ? "" : "s"}`;
  }
  const tooltipText = contextMode === "auto"
    ? `${ownerLabel} · Auto · ${turnsLabel}`
    : pinned
      ? `${ownerLabel} · Manual · Pinned to turn ${firstTurnNumber} (${turnsLabel} included)`
      : `${ownerLabel} · Manual · ${turnsLabel} back`;

  return (
    <div
      ref={barRef}
      className="absolute left-0 top-0 w-6 z-10 touch-none"
      style={{ height: barH, pointerEvents: dragging ? "auto" : "none" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDragging(false)}
    >
      {visibleHandleY != null && lineBottom > 0 && (
        <>
          {/* Gray line above the handle */}
          <div
            className={`absolute left-[9px] w-[3px] rounded-full transition-colors pointer-events-none ${
              contextMode === "auto" && !dragging ? "opacity-50" : ""
            }`}
            style={{
              top: 0,
              height: Math.max(0, visibleHandleY),
              background: dragging ? "rgba(96, 165, 250, 0.35)" : "rgba(113, 113, 122, 0.25)",
            }}
          />

          {/* Colored line below the handle */}
          <div
            className={`absolute left-[9px] w-[3px] rounded-full pointer-events-none ${
              contextMode === "auto" && !dragging ? "opacity-50" : ""
            }`}
            style={{
              top: visibleHandleY,
              height: Math.max(0, visibleLineBottom - visibleHandleY),
              background: dragging
                ? "linear-gradient(180deg, rgba(59,130,246,0.9) 0%, rgba(59,130,246,0.4) 100%)"
                : "linear-gradient(180deg, rgba(59,130,246,0.6) 0%, rgba(59,130,246,0.2) 100%)",
            }}
          />

          {/* Snap direction chevron — positioned further from the handle */}
          {dragging && (
            <div
              className="absolute left-0 z-30 pointer-events-none"
              style={{
                top: snapAbove
                  ? visibleHandleY - 32  /* above */
                  : visibleHandleY + 24, /* below */
              }}
            >
              {snapAbove ? (
                <svg width="22" height="12" viewBox="0 0 22 12" className="text-amber-400">
                  <polygon points="11,0 0,12 22,12" fill="currentColor" />
                </svg>
              ) : (
                <svg width="22" height="12" viewBox="0 0 22 12" className="text-amber-400">
                  <polygon points="11,12 0,0 22,0" fill="currentColor" />
                </svg>
              )}
            </div>
          )}

          {/* Draggable handle */}
          <div
            className="absolute left-[2px] z-20 cursor-ns-resize group/handle"
            style={{ top: visibleHandleY, pointerEvents: "auto" }}
            onPointerDown={handlePointerDown}
          >
            <div
              className={`w-[17px] h-[17px] -translate-y-1/2 rounded-full border-2 shadow-lg transition-all ${
                dragging
                  ? "border-blue-300 bg-blue-500 shadow-blue-500/40 scale-125"
                  : `${
                      contextMode === "auto"
                        ? "border-zinc-600 bg-zinc-800/40 hover:border-blue-400 hover:bg-blue-600/40"
                        : "border-zinc-600 bg-zinc-800 hover:border-blue-400 hover:bg-blue-600/40"
                    }`
              }`}
            />
            {/* Pin toggle (manual mode only) */}
            {contextMode === "manual" && (
              <button
                className="absolute top-1/2 -translate-y-1/2 left-full ml-1.5 p-0.5 rounded transition-colors hover:bg-zinc-700"
                onClick={togglePin}
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); }}
                onPointerUp={e => e.stopPropagation()}
              >
                {pinned ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
                    <path d="M2 10V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6" />
                    <circle cx="6" cy="10" r="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500 hover:text-amber-400">
                    <path d="M2 10V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6" />
                    <circle cx="6" cy="10" r="1" fill="currentColor" />
                  </svg>
                )}
              </button>
            )}
            {/* Hover tooltip: scope · mode · turn count */}
            <div className="absolute top-1/2 -translate-y-1/2 left-full ml-3 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-300 whitespace-nowrap shadow-lg opacity-0 group-hover/handle:opacity-100 transition-opacity pointer-events-none z-30">
              {tooltipText}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
