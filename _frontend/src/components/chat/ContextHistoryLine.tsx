import { useEffect, useRef, useCallback, useState } from "react";
import { putSessionContextConfig, getEffectiveContextConfig, summarizeRange, listSummaryRanges, type SessionContextConfig } from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { snapBoundaryToRanges } from "../../../../_shared/types/context";

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
  const [contextMode, setContextMode] = useState<"sliding" | "fixed">("fixed");
  const [windowSize, setWindowSize] = useState(10);
  const [pinnedTurn, setPinnedTurn] = useState<number | null>(null);
  const [contextOwner, setContextOwner] = useState<"session" | "project" | "global" | "none">("none");
  // Auto compaction mode drives the handle automatically → line is read-only.
  const [autoCompaction, setAutoCompaction] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragClientY, setDragClientY] = useState(0);
  const dragClientYRef = useRef(0);
  const [summarizing, setSummarizing] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [config, setConfig] = useState<SessionContextConfig | null>(null);
  /** Covered summary ranges — for snapping boundaries to summary blocks. */
  const [summaryRanges, setSummaryRanges] = useState<{ startTurn: number; endTurn: number }[]>([]);

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
    // Summary blocks carry fractional data-turn-number (endTurn + 0.5) so they
    // are distinct snap positions from the live turn with the same number.
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turnMap = new Map<number, number>();
    turnEls.forEach((msgEl) => {
      const tn = parseFloat(msgEl.dataset.turnNumber || "0");
      if (!tn || Number.isNaN(tn)) return;
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
    // Summary blocks carry fractional data-turn-number (endTurn + 0.5) so they
    // are distinct snap positions from the live turn with the same number.
    const turnEls = sc.querySelectorAll<HTMLElement>("[data-turn-number]");
    const turnMap = new Map<number, number>();
    turnEls.forEach((msgEl) => {
      const tn = parseFloat(msgEl.dataset.turnNumber || "0");
      if (!tn || Number.isNaN(tn)) return;
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
  const setStoreCtxWindowSize = useChatStore((s) => s.setContextConfigWindowSize);
  const setCompacting = useChatStore((s) => s.setCompacting);

// Sync store value immediately when local firstTurnNumber changes
  const setStoreCtxTn = useChatStore((s) => s.setContextFirstTurnNumber);
  useEffect(() => {
    if (!sessionId) return;
    setStoreCtxTn(firstTurnNumber);
  }, [firstTurnNumber, sessionId, setStoreCtxTn]);

  // Reset the handle immediately when switching sessions/chats so it never
  // lingers at a stale position from the previous conversation while the new
  // session's turns (and recompute) load. The mode/window effects below will
  // re-derive the correct firstTurnNumber once turns are measured.
  useEffect(() => {
    setFirstTurnNumber(null);
    setTurnPositions([]);
  }, [sessionId]);

  // ── Sliding mode: recompute firstTurnNumber from windowSize ────────────
  useEffect(() => {
    if (contextMode !== "sliding" || turnPositions.length === 0) return;
    // "N turns" counts LIVE turns only; summary blocks are not turns.
    const numbers = turnPositions.map((t) => t.number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
    const lastTurn = numbers[numbers.length - 1];
    let firstTn: number | null;
    if (windowSize === -1) {
      firstTn = null; // all turns (no filtering)
    } else if (windowSize === 0) {
      firstTn = lastTurn + 1; // no turns (beyond last turn)
    } else {
      // "N turns" = the last N turns in context (current turn is always sent).
      // firstTurnNumber = the (N)-th-from-last turn = numbers[length - N].
      const idx = numbers.length - windowSize;
      const tn = idx >= 0 ? numbers[Math.min(idx, numbers.length - 1)] : numbers[0];
      firstTn = tn > numbers[0] ? tn : null;
    }
    // Snap so the boundary never lands inside a summarized range — the handle
    // may rest on a summary block (fractional anchor).
    const snapped = snapBoundaryToRanges(firstTn, summaryRanges);
    setFirstTurnNumber(snapped);
    // Immediate sync to store so sendMessage sees the value without extra render cycle
    setStoreCtxTn(snapped);
    setStoreCtxMode(contextMode);
    setStoreCtxWindowSize(windowSize);
  }, [contextMode, windowSize, turnPositions, summaryRanges]);

  // ── Fixed mode: firstTurnNumber stays at pinnedTurn (unless user drags) ──
  useEffect(() => {
    if (contextMode !== "fixed" || turnPositions.length === 0) return;
    if (pinnedTurn != null) {
      const snapped = snapBoundaryToRanges(pinnedTurn, summaryRanges);
      setFirstTurnNumber(snapped);
      setStoreCtxTn(snapped);
      setStoreCtxMode(contextMode);
      setStoreCtxWindowSize(windowSize);
    }
  }, [contextMode, pinnedTurn, turnPositions, summaryRanges]);

  // Re-load when store version bumps (ContextPanel saves)
  const ctxCfgVersion = useChatStore((s) => s.contextConfigVersion);

  // Covered summary ranges — refreshed on config bump AND when the message
  // count changes (a completed summary adds messages). Used to snap auto and
  // turns-back boundaries onto summary blocks so the handle can sit on them.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    listSummaryRanges(sessionId)
      .then((res) => {
        if (cancelled) return;
        setSummaryRanges(res.ranges.map((r) => ({ startTurn: r.startTurn, endTurn: r.endTurn })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, ctxCfgVersion, messageCount]);

  // ── Load context config (also reads mode/windowSize/pinnedTurn) ────────────────
  useEffect(() => {
    if (!sessionId) return;
    getEffectiveContextConfig(sessionId, workspaceRoot || undefined)
      .then((c) => {
        setConfig(c);
        setFirstTurnNumber(c.firstTurnNumber ?? null);
        setContextMode(c.mode ?? "fixed");
        setWindowSize(c.windowSize ?? 10);
        setPinnedTurn(c.pinnedTurn ?? null);
        setContextOwner(c.owner ?? "none");
        setAutoCompaction(c.autoCompactionEnabled ?? false);
        // Sync to store so sendMessage always has the effective config
        setStoreCtxMode(c.mode ?? "fixed");
        setStoreCtxWindowSize(c.windowSize ?? 10);
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
    dragClientYRef.current = e.clientY;
    setDragging(true);
    setDragClientY(e.clientY);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      // Track raw cursor (no snap until release)
      setDragClientY(e.clientY);
      dragClientYRef.current = e.clientY;
    },
    [dragging],
  );

  // Continuous auto-scroll while dragging: when the cursor is held within
  // EDGE px of the container top/bottom, keep scrolling on every frame.
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const sc = scrollRef.current;
    if (!sc) return;
    const EDGE = 40;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const rect = sc.getBoundingClientRect();
      const clientY = dragClientYRef.current;
      if (clientY < rect.top + EDGE) {
        sc.scrollTop -= Math.max(1, Math.round((rect.top + EDGE - clientY) * 0.4));
        measure();
      } else if (clientY > rect.bottom - EDGE) {
        sc.scrollTop += Math.max(1, Math.round((clientY - (rect.bottom - EDGE)) * 0.4));
        measure();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, scrollRef, measure]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setDragging(false);
      const snap = getSnapTurn(e.clientY);
      if (snap == null || !sessionId) return;
      const minTurn = turnPositions.length > 0 ? turnPositions[0].number : 1;
      const value = snap <= minTurn ? null : snap;
      // User explicitly adjusted → switch to fixed mode (pinned to this turn)
      setContextMode("fixed");
      setFirstTurnNumber(value);
      setPinnedTurn(value);
      putSessionContextConfig(sessionId, { pinnedTurn: value, mode: "fixed", enabled: true }).catch(() => {});
    },
    [getSnapTurn, sessionId, turnPositions],
  );

  const togglePin = useCallback(() => {
    if (contextMode === "fixed") {
      // Unpin: convert current pinned position to a sliding window size.
      const numbers = turnPositions.map((t) => t.number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
      let windowSize = 10;
      if (pinnedTurn != null && numbers.length > 0) {
        if (Number.isInteger(pinnedTurn)) {
          const idx = numbers.indexOf(pinnedTurn);
          if (idx >= 0) windowSize = numbers.length - idx;
        } else {
          // Summary anchor E+0.5 → live turns after E
          windowSize = numbers.filter((n) => n > Math.floor(pinnedTurn)).length;
        }
      } else if (numbers.length > 0) {
        // Pinned to the first message → keep all turns as the window size
        windowSize = numbers.length;
      }
      setWindowSize(windowSize);
      setContextMode("sliding");
      setPinnedTurn(null);
      if (sessionId) {
        putSessionContextConfig(sessionId, {
          mode: "sliding",
          windowSize,
          pinnedTurn: null,
          enabled: true,
        }).catch(() => {});
      }
    } else if (contextMode === "sliding" && firstTurnNumber != null) {
      // Pin: convert current sliding position to fixed
      setContextMode("fixed");
      setPinnedTurn(firstTurnNumber);
      if (sessionId) {
        putSessionContextConfig(sessionId, {
          mode: "fixed",
          pinnedTurn: firstTurnNumber,
          enabled: true,
        }).catch(() => {});
      }
    }
  }, [sessionId, contextMode, firstTurnNumber, pinnedTurn, turnPositions]);

  // endTurnNum = slider position (turn the handle sits on), per design spec.
  // firstTurnNumber set → that turn; null (all turns) → last turn on the line.
  // A fractional anchor means the handle sits on a summary block — that range
  // is already summarized, so summarizing is disabled.
  const summarizeAnchor = (() => {
    if (firstTurnNumber != null && firstTurnNumber >= 1) return firstTurnNumber;
    if (turnPositions.length > 0) return turnPositions[turnPositions.length - 1]!.number;
    return null;
  })();
  const onSummaryAnchor = summarizeAnchor != null && !Number.isInteger(summarizeAnchor);
  const summarizeEndTurn = onSummaryAnchor ? null : summarizeAnchor;
  const summarizeDisabledReason = onSummaryAnchor && summarizeAnchor != null
    ? `Already summarized up to turn ${Math.floor(summarizeAnchor)}`
    : null;
  const canSummarize =
    !!sessionId && summarizeEndTurn != null && summarizeEndTurn >= 1 && !summarizing && turnPositions.length > 0;

  const runSummarize = useCallback(async (initiator: string) => {
    setCtxMenu(null);
    if (!sessionId || summarizeEndTurn == null || summarizeEndTurn < 1) {
      setSummarizeError(!sessionId ? "No session" : summarizeDisabledReason ?? "No turns to summarize");
      return;
    }
    if (summarizing) return;
    setSummarizing(true);
    setCompacting(true);
    setSummarizeError(null);
    try {
      const result = await summarizeRange({
        sessionId,
        workspaceRoot: workspaceRoot || undefined,
        endTurnNum: summarizeEndTurn,
        includePriorSummary: config?.summarizeIncludePriorSummary ?? true,
        initiator,
      });
      console.info("[summarize] ok", result);
      if (result.created === false) {
        // Idempotent hit — already have this block. Do not reload/scroll.
        setSummarizeError(`Already have summary through turn ${result.endTurn ?? summarizeEndTurn}`);
        window.setTimeout(() => setSummarizeError(null), 2500);
        return;
      }
      // New summary: backend pushes session_state. Soft refresh without loadSession.
      try {
        const { beginReconnectSession } = await import("../../features/chat/session-hydrate");
        const { wsClient } = await import("../../lib/ws");
        const requestId = beginReconnectSession();
        wsClient.send({ type: "request_session_state", sessionId, requestId });
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        const nodes = [...document.querySelectorAll<HTMLElement>("[data-summary-end]")];
        const target = nodes.find((n) => Number(n.dataset.summaryEnd || 0) === (result.endTurn ?? summarizeEndTurn));
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Summarize failed";
      console.error("[summarize] failed", e);
      setSummarizeError(msg);
    } finally {
      setSummarizing(false);
      setCompacting(false);
    }
  }, [sessionId, summarizeEndTurn, summarizing, workspaceRoot, config, summarizeDisabledReason, setCompacting]);

  // Cmd/Ctrl+Shift+S → summarize at slider
  useEffect(() => {
    if (!sessionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "S" && e.key !== "s") return;
      if (autoCompaction) return; // auto mode summarizes itself
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      void runSummarize("keyboard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionId, runSummarize, autoCompaction]);

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
  // Live turns only — summary blocks are boundaries, not turns.
  const livePositions = turnPositions.filter((t) => Number.isInteger(t.number));
  let turnsLabel: string;
  if (contextMode === "sliding") {
    if (windowSize === -1) turnsLabel = "All turns";
    else if (windowSize === 0) turnsLabel = "None";
    else turnsLabel = `${windowSize} turn${windowSize === 1 ? "" : "s"} (sliding)`;
  } else {
    // Fixed: count drives from pinnedTurn to end (or all if null)
    if (firstTurnNumber == null) turnsLabel = "All turns";
    else if (!Number.isInteger(firstTurnNumber)) {
      // Summary anchor E+0.5 → live turns after E.
      const after = livePositions.filter((p) => p.number > Math.floor(firstTurnNumber)).length;
      turnsLabel = `${after} turn${after === 1 ? "" : "s"} (fixed)`;
    } else {
      const count = Math.max(0, livePositions.length - firstTurnNumber + 1);
      turnsLabel = `${count} turn${count === 1 ? "" : "s"} (fixed)`;
    }
  }
  // In fixed mode it is ALWAYS pinned — either to the first message (no pin
  // moved yet) or to a specific turn the user chose. Sliding off = pinned.
  const isPinned = contextMode === "fixed";
  // In auto compaction the handle is driven by the system — read-only (greyed).
  const interactive = !autoCompaction;
  const noop = () => {};
  const pinLabel = firstTurnNumber == null
    ? "the first message"
    : !Number.isInteger(firstTurnNumber)
      ? `summary through turn ${Math.floor(firstTurnNumber)}`
      : `turn ${firstTurnNumber}`;
  const tooltipText = contextMode === "sliding"
    ? `${ownerLabel} · Sliding · ${turnsLabel}`
    : `${ownerLabel} · Fixed · Pinned to ${pinLabel} (${turnsLabel} included)`;

  // Line sits in center of the 64px gutter so pin/summarize stay inside the rail
  // (not over the message scroller, which was stealing clicks → scroll).
  const lineX = 24; // center of w-16 rail

  return (
    <div
      ref={barRef}
      className="absolute inset-0 z-30"
      style={{ height: barH, pointerEvents: "none" }}
    >
      {visibleHandleY != null && lineBottom > 0 && (
        <>
          {/* Gray line above the handle */}
          <div
            className={`absolute w-[3px] rounded-full transition-colors pointer-events-none ${
              contextMode === "sliding" && !dragging ? "opacity-50" : ""
            }`}
            style={{
              left: lineX - 1,
              top: 0,
              height: Math.max(0, visibleHandleY),
              background: dragging ? "rgba(96, 165, 250, 0.35)" : "rgba(113, 113, 122, 0.25)",
            }}
          />

          {/* Colored line below the handle */}
          <div
            className={`absolute w-[3px] rounded-full pointer-events-none ${
              contextMode === "sliding" && !dragging ? "opacity-50" : ""
            }`}
            style={{
              left: lineX - 1,
              top: visibleHandleY,
              height: Math.max(0, visibleLineBottom - visibleHandleY),
              background: dragging
                ? "linear-gradient(180deg, rgba(59,130,246,0.9) 0%, rgba(59,130,246,0.4) 100%)"
                : "linear-gradient(180deg, rgba(59,130,246,0.6) 0%, rgba(59,130,246,0.2) 100%)",
            }}
          />

          {/* Snap direction chevron */}
          {dragging && (
            <div
              className="absolute z-30 pointer-events-none"
              style={{
                left: lineX - 11,
                top: snapAbove ? visibleHandleY - 32 : visibleHandleY + 24,
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

          {/* Drag circle ONLY — separate from action buttons.
              move/up on this node (setPointerCapture target). */}
          <div
            className={`absolute z-40 group/handle ${interactive ? "cursor-ns-resize" : "cursor-default"}`}
            style={{
              left: lineX - 9,
              top: visibleHandleY - 9,
              width: 18,
              height: 18,
              pointerEvents: autoCompaction ? "none" : "auto",
              touchAction: "none",
            }}
            title={tooltipText}
            onPointerDown={interactive ? handlePointerDown : noop}
            onPointerMove={interactive ? handlePointerMove : noop}
            onPointerUp={interactive ? handlePointerUp : noop}
            onPointerCancel={() => setDragging(false)}
            onContextMenu={interactive ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            } : noop}
          >
            <div
              className={`w-[18px] h-[18px] rounded-full border-2 shadow-lg transition-all ${
                dragging
                  ? "border-blue-300 bg-blue-500 shadow-blue-500/40 scale-125"
                  : autoCompaction
                    ? "border-zinc-600/50 bg-zinc-800/30 opacity-60"
                    : contextMode === "sliding"
                      ? "border-zinc-600 bg-zinc-800/40 hover:border-blue-400 hover:bg-blue-600/40"
                      : "border-zinc-600 bg-zinc-800 hover:border-blue-400 hover:bg-blue-600/40"
              }`}
            />
          </div>

          {/* Pin + summarize horizontal, below circle, inside gutter */}
          <div
            className="absolute z-50 flex flex-row items-center gap-0.5"
            style={{
              left: lineX - 26,
              top: visibleHandleY + 12,
              width: 52,
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              title={autoCompaction ? "Auto compaction manages the context" : (isPinned ? "Unpin (switch to sliding)" : "Pin to this turn (fixed)")}
              disabled={!interactive}
              className="w-6 h-6 flex items-center justify-center rounded bg-zinc-900/90 border border-zinc-700 hover:bg-zinc-700 shrink-0 disabled:opacity-40 disabled:hover:bg-zinc-900/90"
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (interactive) togglePin(); }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={isPinned ? 2 : 1.5} className={isPinned ? "text-amber-400" : "text-zinc-400"}>
                <path d="M2 10V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6" />
                <circle cx="6" cy="10" r="1" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              title={
                autoCompaction
                  ? "Auto compaction summarizes automatically"
                  : canSummarize
                    ? `Summarize up to turn ${summarizeEndTurn} (Ctrl/⌘+Shift+S)`
                    : summarizing
                      ? "Summarizing…"
                      : summarizeDisabledReason ?? "No turns to summarize"
              }
              className={`w-6 h-6 flex items-center justify-center rounded border transition-colors shrink-0 ${
                summarizing
                  ? "bg-violet-900/80 border-violet-500 text-violet-200 animate-pulse"
                  : autoCompaction
                    ? "bg-zinc-900/30 border-zinc-800 text-zinc-600"
                    : canSummarize
                      ? "bg-zinc-900/90 border-zinc-700 text-violet-400 hover:bg-violet-950 hover:border-violet-500"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-600"
              }`}
              disabled={!interactive}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (interactive && e.button === 0) void runSummarize("slider");
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2.5h8M2 9.5h8M3.5 6h5" strokeLinecap="round" />
                <path d="M6 4v4M4.5 5L6 4l1.5 1M4.5 7L6 8l1.5-1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {summarizeError && (
              <div className="absolute left-0 top-full mt-1 px-2 py-1 rounded bg-red-950 border border-red-700 text-[10px] text-red-300 whitespace-nowrap shadow-lg max-w-[200px] truncate z-50">
                {summarizeError}
              </div>
            )}
            {summarizing && (
              <div className="absolute left-0 top-full mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-[10px] text-zinc-300 whitespace-nowrap shadow-lg z-50">
                Summarizing…
              </div>
            )}
          </div>
        </>
      )}

      {/* Right-click menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[60]" style={{ pointerEvents: "auto" }} onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div
            className="fixed z-[70] bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y, pointerEvents: "auto" }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              disabled={!canSummarize}
              onClick={() => { void runSummarize("context-menu"); }}
            >
              {summarizing
                ? "Summarizing…"
                : summarizeEndTurn != null
                  ? `Summarize up to turn ${summarizeEndTurn}`
                  : summarizeDisabledReason ?? "Summarize up to here"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
