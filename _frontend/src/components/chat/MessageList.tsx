import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { MessageRow } from "./MessageRow";
import { ContextHistoryLine } from "./ContextHistoryLine";
import { ThinkingIndicator } from "./parts/ThinkingIndicator";
import type { MessagePartType } from "../../../../_shared/types";

const PIN_EPSILON = 4;
const PIN_FALLBACK_PX = 96;
const SCROLL_STOP_MS = 150;

function sortParts(parts: MessagePartType[]): MessagePartType[] {
  return [...parts].sort((a, b) => {
    const sa = (a as any)._seq ?? 0;
    const sb = (b as any)._seq ?? 0;
    return sa - sb;
  });
}

interface SummaryTurnGroup {
  /** System generation marker — lives at the TOP of the expanded card. */
  marker?: Message;
  userMsg: Message;
  assistantMsg: Message;
  turnId: number;
  summaryEndTurn: number | undefined;
  summaryStartTurn: number | undefined;
}

function groupSummaryTurns(messages: Message[]): (Message | SummaryTurnGroup)[] {
  const result: (Message | SummaryTurnGroup)[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    // Completed summary block: [system marker, user, assistant] (same turnId).
    // The marker is a child of the collapsible card (top of its content).
    if (
      msg.isSummary &&
      msg.role === "system" &&
      i + 2 < messages.length &&
      messages[i + 1].isSummary &&
      messages[i + 1].role === "user" &&
      messages[i + 2].isSummary &&
      messages[i + 2].role === "assistant" &&
      messages[i + 1].turnId === msg.turnId &&
      messages[i + 2].turnId === msg.turnId
    ) {
      result.push({
        marker: msg,
        userMsg: messages[i + 1],
        assistantMsg: messages[i + 2],
        turnId: msg.turnId!,
        summaryEndTurn: msg.summaryEndTurn,
        summaryStartTurn: msg.summaryStartTurn,
      });
      i += 3;
      continue;
    }
    // Legacy / pending pair (user + assistant only).
    if (
      msg.isSummary &&
      msg.role === "user" &&
      i + 1 < messages.length &&
      messages[i + 1].isSummary &&
      messages[i + 1].role === "assistant" &&
      messages[i + 1].turnId === msg.turnId
    ) {
      result.push({
        userMsg: msg,
        assistantMsg: messages[i + 1],
        turnId: msg.turnId!,
        summaryEndTurn: msg.summaryEndTurn,
        summaryStartTurn: msg.summaryStartTurn,
      });
      i += 2;
      continue;
    }
    result.push(msg);
    i++;
  }
  return result;
}

export function MessageList() {
  const { messages, streaming, streamingContent, streamingParts, sessionId, streamingTurnId, sessionMeta, _pendingAgentName, _pendingModelName, _pendingProviderName } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const pendingScrollRef = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Expanded state for summary turns (keyed by turnId) - default collapsed
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());

  const toggleSummary = useCallback((turnId: number) => {
    setExpandedSummaries((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }
      return next;
    });
  }, []);

  // When a session switches, freeze the container invisible and jump-scroll
  // to the bottom once messages arrive — no visible top-to-bottom animation.
  const [frozen, setFrozen] = useState(false);
  const lastSessionRef = useRef(sessionId);
  const needsInstantScrollRef = useRef(false);
  useEffect(() => {
    if (sessionId === lastSessionRef.current) return;
    lastSessionRef.current = sessionId;
    needsInstantScrollRef.current = true;
    setFrozen(true);
    // Safety valve: never keep the list hidden forever if no new rows arrive.
    const thaw = window.setTimeout(() => setFrozen(false), 300);
    return () => window.clearTimeout(thaw);
  }, [sessionId]);

  const checkPinned = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      pinnedRef.current = true;
      setShowScrollDown(false);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // No meaningful overflow: nothing to scroll, always pinned.
    if (distanceFromBottom <= PIN_EPSILON) {
      pinnedRef.current = true;
      setShowScrollDown(false);
      return;
    }
    // Pin (auto-scroll) while the last message is still "under" the input card.
    // The floating card sits at `bottom: 16px` with height = cardHeight, so any
    // last message within (cardHeight + 16) of the view bottom overlaps it.
    const inputCard = document.getElementById("chat-input-card");
    const cardH = inputCard ? inputCard.getBoundingClientRect().height : 0;
    const threshold = (cardH > 0 ? cardH : PIN_FALLBACK_PX) + 16 + PIN_EPSILON;
    const pinned = distanceFromBottom <= threshold;
    pinnedRef.current = pinned;
    setShowScrollDown(!pinned);
  }, []);

  // Track active scroll gestures so we never yank the view mid-scroll.
  const handleScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      isScrollingRef.current = false;
      // If a message arrived while scrolling, catch up once the user stops.
      if (pendingScrollRef.current && pinnedRef.current) {
        pendingScrollRef.current = false;
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }, SCROLL_STOP_MS);
    checkPinned();
  }, [checkPinned]);

  useEffect(() => {
    if (needsInstantScrollRef.current && messages.length > 0) {
      // Session just switched — jump to bottom instantly while hidden.
      needsInstantScrollRef.current = false;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setFrozen(false);
      return;
    }
    if (!pinnedRef.current) return;
    // Don't fight the user mid-gesture; defer the jump until they stop.
    if (isScrollingRef.current) {
      pendingScrollRef.current = true;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingParts]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const scrollToBottom = () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    isScrollingRef.current = false;
    pendingScrollRef.current = false;
    needsInstantScrollRef.current = false;
    setFrozen(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    pinnedRef.current = true;
    setShowScrollDown(false);
  };

  // Backend owns order via durable _seq; streamingParts is the full log
  // (text + tools + reasoning). No client-side invent/flush of text.
  const streamingMessageParts: MessagePartType[] | undefined = useMemo(() => {
    if (!streaming || streamingParts.length === 0) return undefined;
    return sortParts(streamingParts);
  }, [streaming, streamingParts]);


  const isThinking = streaming && streamingParts.length === 0;

  // System messages are normally hidden (never part of the chat thread), but
  // summary-generation markers (role system + isSummary) ARE part of the
  // timeline — they occupy the summary position while generating.
  const visibleMessages = messages.filter((m) => m.role !== "system" || m.isSummary === true);
  const groupedMessages = groupSummaryTurns(visibleMessages);

  return (
    <div className="flex flex-1 overflow-hidden">
      {sessionId && (
        <div className="w-16 flex-shrink-0 relative z-20 overflow-visible">
          <ContextHistoryLine sessionId={sessionId} scrollRef={scrollRef} messageCount={visibleMessages.filter(m => m.turnId != null).length} />
        </div>
      )}
      <div
        className="flex-1 overflow-y-auto px-[5%] py-4 space-y-1"
        ref={scrollRef}
        onScroll={handleScroll}
        style={frozen ? { visibility: "hidden" } : undefined}
        data-scroll
      >
      {groupedMessages.map((item) => {
        if (typeof item === "object" && "userMsg" in item) {
          // Summary turn group
          const { marker, userMsg, assistantMsg, turnId, summaryEndTurn, summaryStartTurn } = item;
          const isCollapsed = !expandedSummaries.has(turnId);
          return (
            <div
              key={`summary-${turnId}`}
              data-summary-turn={turnId}
              data-summary-end={summaryEndTurn ?? ""}
              // Let the context circle snap to the summary's anchor position.
              // Half-step (endTurn + 0.5) keeps the block distinct from the
              // live turn carrying the same number. The handle reads
              // [data-turn-number] with parseFloat.
              data-turn-number={summaryEndTurn != null ? summaryEndTurn + 0.5 : undefined}
              className="animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
              <SummaryTurnWrapper
                marker={marker}
                userMsg={userMsg}
                assistantMsg={assistantMsg}
                summaryEndTurn={summaryEndTurn}
                summaryStartTurn={summaryStartTurn}
                isCollapsed={isCollapsed}
                onToggle={() => toggleSummary(turnId)}
                messages={messages}
              />
            </div>
          );
        } else {
          // Regular message (or a standalone summary system marker while a
          // summary is streaming / after it failed — no user/assistant pair).
          const anchor = item.isSummary
            ? (item.summaryEndTurn != null ? item.summaryEndTurn + 0.5 : undefined)
            : (item.turnId != null ? item.turnId : undefined);
          return (
            <div
              key={item.id}
              data-turn-number={anchor}
              {...(item.isSummary && item.summaryEndTurn != null ? { "data-summary-end": String(item.summaryEndTurn) } : {})}
              className="animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
              <MessageRow message={item} />
            </div>
          );
        }
      })}
      {streaming && streamingMessageParts && (
        <MessageRow
          message={{
            role: "assistant",
            content: streamingContent,
            parts: streamingMessageParts,
            timestamp: new Date().toISOString(),
            turnId: streamingTurnId ?? undefined,
            agentName: _pendingAgentName || sessionMeta?.agentName || undefined,
            modelName: _pendingModelName || sessionMeta?.modelName || undefined,
            providerName: _pendingProviderName || sessionMeta?.providerName || undefined,
          }}
          isStreaming
        />
      )}
      {isThinking && (
        <div className="flex items-start px-1">
          <ThinkingIndicator />
        </div>
      )}
      <div ref={bottomRef} />
      {showScrollDown && (
        <div className="sticky bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={scrollToBottom}
            className="pointer-events-auto rounded-full bg-zinc-800 border border-zinc-700 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-all shadow-lg"
          >
            <ChevronDown size={18} />
          </button>
        </div>
      )}
    </div>
    </div>
  );
}

interface SummaryTurnWrapperProps {
  marker?: Message;
  userMsg: Message;
  assistantMsg: Message;
  summaryEndTurn: number | undefined;
  summaryStartTurn: number | undefined;
  isCollapsed: boolean;
  onToggle: () => void;
  messages: Message[];
}

import type { Message } from "../../../../_shared/types/message";

function SummaryTurnWrapper({
  marker,
  userMsg,
  assistantMsg,
  summaryEndTurn,
  summaryStartTurn,
  isCollapsed,
  onToggle,
  messages,
}: SummaryTurnWrapperProps) {
  const label = summaryEndTurn != null
    ? `Summary · turns ${summaryStartTurn}–${summaryEndTurn}`
    : "Summary";

  // The summarizer's input was the covered turns PLUS the prior chain summary
  // (if any). On hover, show the covered range and note whether a prior summary
  // was included.
  const priorSummary = messages.find(
    (m) => m.isSummary && m.summaryEndTurn != null && summaryStartTurn != null && m.summaryEndTurn < summaryStartTurn && m.summaryStartTurn != null,
  );

  const tooltip = [
    "This summary was generated from:",
    `  • Turns ${summaryStartTurn ?? "?"}–${summaryEndTurn ?? "?"}`,
    priorSummary
      ? `  • Previous summary (turns ${priorSummary.summaryStartTurn}–${priorSummary.summaryEndTurn})`
      : "  • (no prior summary)",
  ].join("\n");

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
        onClick={onToggle}
        title={tooltip}
      >
        {isCollapsed ? <ChevronRight size={14} className="text-blue-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-blue-400 flex-shrink-0" />}
        <span className="text-[10px] font-medium uppercase tracking-wider text-blue-400">{label}</span>
      </button>
      {!isCollapsed && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-150 border-t border-blue-500/20">
          <div className="space-y-1">
            {/* Generation marker sits at the top of the expanded card. */}
            {marker && <MessageRow message={marker} />}
            <MessageRow message={userMsg} />
            <MessageRow message={assistantMsg} />
          </div>
        </div>
      )}
    </div>
  );
}
