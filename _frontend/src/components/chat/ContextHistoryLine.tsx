import { useEffect, useRef, useCallback, useState } from "react";
import { getSessionContextConfig, putSessionContextConfig } from "../../lib/api";
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
  const [dragging, setDragging] = useState(false);

  // Turn Y positions (scroll-dependent — recalculated on every scroll)
  const [turnPositions, setTurnPositions] = useState<{ number: number; y: number }[]>([]);
  // Bottom of the last message (scroll-stable — only recalculated on mutation)
  const [lineBottom, setLineBottom] = useState(0);

  const measure = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const containerRect = sc.getBoundingClientRect();
    const scrollTop = sc.scrollTop;

    // Turn positions in scroll-container-relative coords
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turns: { number: number; y: number }[] = [];
    turnEls.forEach((msgEl) => {
      const tn = parseInt(msgEl.dataset.turnNumber || "0", 10);
      if (!tn) return;
      const rect = msgEl.getBoundingClientRect();
      // Convert viewport-relative Y to scroll-container-relative Y
      const y = rect.top - containerRect.top + scrollTop + rect.height / 2;
      turns.push({ number: tn, y });
    });
    turns.sort((a, b) => a.number - b.number);
    setTurnPositions(turns);
  }, [scrollRef]);

  /** Full remeasure — also recalculates the bottom of the last message. */
  const fullMeasure = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const containerRect = sc.getBoundingClientRect();
    const scrollTop = sc.scrollTop;

    // Turn positions
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turns: { number: number; y: number }[] = [];
    turnEls.forEach((msgEl) => {
      const tn = parseInt(msgEl.dataset.turnNumber || "0", 10);
      if (!tn) return;
      const rect = msgEl.getBoundingClientRect();
      const y = rect.top - containerRect.top + scrollTop + rect.height / 2;
      turns.push({ number: tn, y });
    });
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

  // Load persisted config into local state (for handle rendering)
  useEffect(() => {
    if (!sessionId) return;
    getSessionContextConfig(sessionId)
      .then((c) => setFirstTurnNumber(c.firstTurnNumber))
      .catch(() => {});
  }, [sessionId]);

  // Sync store value when dragging changes firstTurnNumber
  const setStoreCtxTn = useChatStore((s) => s.setContextFirstTurnNumber);
  useEffect(() => {
    if (!sessionId) return;
    setStoreCtxTn(firstTurnNumber);
  }, [firstTurnNumber, sessionId, setStoreCtxTn]);

  // Find snap target from cursor Y
  const getSnapTurn = useCallback(
    (clientY: number): number | null => {
      const sc = scrollRef.current;
      if (!sc || turnPositions.length === 0) return null;
      const containerRect = sc.getBoundingClientRect();
      const cursorY = clientY - containerRect.top + sc.scrollTop;

      let closest = turnPositions[0];
      let minDist = Math.abs(cursorY - closest.y);
      for (let i = 1; i < turnPositions.length; i++) {
        const dist = Math.abs(cursorY - turnPositions[i].y);
        if (dist < minDist) {
          minDist = dist;
          closest = turnPositions[i];
        }
      }
      return closest.number;
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
      const snap = getSnapTurn(e.clientY);
      if (snap != null) setFirstTurnNumber(snap);
    },
    [dragging, getSnapTurn],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setDragging(false);
      const snap = getSnapTurn(e.clientY);
      if (snap == null || !sessionId) return;
      const minTurn = turnPositions.length > 0 ? turnPositions[0].number : 1;
      const value = snap <= minTurn ? null : snap;
      setFirstTurnNumber(value);
      putSessionContextConfig(sessionId, { firstTurnNumber: value }).catch(() => {});
    },
    [getSnapTurn, sessionId, turnPositions],
  );

  // Handle Y in scroll-container-relative coords
  let handleY: number | null = null;
  if (turnPositions.length > 0) {
    if (firstTurnNumber == null) {
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
            className="absolute left-[9px] w-[3px] rounded-full transition-colors pointer-events-none"
            style={{
              top: 0,
              height: Math.max(0, visibleHandleY),
              background: dragging ? "rgba(96, 165, 250, 0.35)" : "rgba(113, 113, 122, 0.25)",
            }}
          />

          {/* Colored line below the handle */}
          <div
            className="absolute left-[9px] w-[3px] rounded-full pointer-events-none"
            style={{
              top: visibleHandleY,
              height: Math.max(0, visibleLineBottom - visibleHandleY),
              background: dragging
                ? "linear-gradient(180deg, rgba(59,130,246,0.9) 0%, rgba(59,130,246,0.4) 100%)"
                : "linear-gradient(180deg, rgba(59,130,246,0.6) 0%, rgba(59,130,246,0.2) 100%)",
            }}
          />

          {/* Draggable handle */}
          <div
            className="absolute left-[2px] z-20 cursor-ns-resize"
            style={{ top: visibleHandleY, pointerEvents: "auto" }}
            onPointerDown={handlePointerDown}
          >
            <div
              className={`w-[17px] h-[17px] -translate-y-1/2 rounded-full border-2 shadow-lg transition-all ${
                dragging
                  ? "border-blue-300 bg-blue-500 shadow-blue-500/40 scale-125"
                  : "border-zinc-600 bg-zinc-800 hover:border-blue-400 hover:bg-blue-600/40"
              }`}
            />
          </div>
        </>
      )}
    </div>
  );
}