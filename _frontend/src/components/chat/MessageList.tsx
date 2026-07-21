import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { MessageRow } from "./MessageRow";
import { ThinkingIndicator } from "./parts/ThinkingIndicator";
import type { MessagePartType } from "../../../_shared/types";

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

export function MessageList() {
  const { messages, streaming, streamingContent, streamingParts, sessionId } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const pendingScrollRef = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);



    console.log("sessionId:",sessionId)

  // When a session switches, freeze the container invisible and jump-scroll
  // to the bottom once messages arrive — no visible top-to-bottom animation.
  const [frozen, setFrozen] = useState(false);
  const lastSessionRef = useRef(sessionId);
  const needsInstantScrollRef = useRef(false);
  if (sessionId !== lastSessionRef.current) {
    lastSessionRef.current = sessionId;
    needsInstantScrollRef.current = true;
    setFrozen(true);
  }

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
    if (!pinnedRef.current) return;
    // Don't fight the user mid-gesture; defer the jump until they stop.
    if (isScrollingRef.current) {
      pendingScrollRef.current = true;
      return;
    }
    if (needsInstantScrollRef.current && messages.length > 0) {
      // Session just switched — jump to bottom instantly while hidden.
      needsInstantScrollRef.current = false;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setFrozen(false);
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

  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <div
      className="flex-1 overflow-y-auto px-[5%] py-4 space-y-1 relative"
      ref={scrollRef}
      onScroll={handleScroll}
      style={frozen ? { visibility: "hidden" } : undefined}
      data-scroll
    >
      {visibleMessages.map((msg, i) => (
        <div key={i} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          <MessageRow message={msg} />
        </div>
      ))}
      {streaming && streamingMessageParts && (
        <MessageRow
          message={{
            role: "assistant",
            content: streamingContent,
            parts: streamingMessageParts,
            timestamp: new Date().toISOString(),
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
  );
}
