import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronUp, ChevronDown, MessageSquare, Pin, PinOff, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { useConfigStore } from "../../stores/config";

const btnClass =
  "flex items-center justify-center px-2 py-1.5 rounded-lg text-xs transition-colors bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700/60 hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed";

export function LastMessageButton() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [userMsgIndex, setUserMsgIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const messages = useChatStore((s) => s.messages);
  const fullWidth = useConfigStore((s) => s.config.messagePanelFullWidth ?? false);
  const pinnedDefault = useConfigStore((s) => s.config.messagePanelPinnedDefault ?? false);

  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === "user");
  }, [messages]);

  const total = userMessages.length;
  const isCurrent = userMsgIndex === total - 1;

  const currentUserMessage = userMessages[userMsgIndex]?.content ?? null;

  const close = useCallback(() => {
    if (!pinned) { setOpen(false); setUserMsgIndex(0); }
  }, [pinned]);

  const goUp = useCallback(() => {
    setUserMsgIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goDown = useCallback(() => {
    setUserMsgIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);

  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setUserMsgIndex(0);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, pinned]);

  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setUserMsgIndex(0); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, pinned]);

  if (total === 0) return null;

  return (
    <div
      ref={containerRef}
      className={`absolute top-3 z-20 flex flex-col items-end ${fullWidth && open ? "left-3 right-3" : "right-3"}`}
    >
      <div className="flex items-center gap-1">
        {open && (
          <>
            <span className="text-[10px] text-zinc-500 whitespace-nowrap px-1">
              {userMsgIndex + 1}/{total}{isCurrent ? " current" : ""}
            </span>
            <button
              type="button"
              onClick={goUp}
              disabled={userMsgIndex <= 0}
              className={btnClass}
              title="Previous user message"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={goDown}
              disabled={userMsgIndex >= total - 1}
              className={btnClass}
              title="Next user message"
            >
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              data-testid="message-panel-pin"
              onClick={() => setPinned((p) => !p)}
              className={btnClass}
              title={pinned ? "Unpin" : "Pin open"}
            >
              {pinned ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
          </>
        )}
        <button
          type="button"
          data-testid="message-panel-toggle"
          onClick={() => { setOpen(!open); if (!open) setUserMsgIndex(total - 1); else { setPinned(false); setUserMsgIndex(0); } }}
          className={btnClass}
          title={open ? "Close" : "Show last message"}
        >
          {open ? <X size={14} /> : <MessageSquare size={14} />}
        </button>
      </div>

      {open && currentUserMessage && (
        <div
          data-testid="message-panel"
          className={`mt-1.5 ${fullWidth ? "w-full" : "w-80"} max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl p-3`}
        >
          <p className="text-xs text-zinc-400 whitespace-pre-wrap break-words">
            {currentUserMessage}
          </p>
        </div>
      )}
    </div>
  );
}
