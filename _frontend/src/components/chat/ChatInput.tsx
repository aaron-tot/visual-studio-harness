import { useRef, useEffect, useCallback } from "react";
import { Square, Send } from "lucide-react";
import { useChatStore } from "../../stores/chat";

interface ChatInputProps {
  /** Extra class on the form wrapper */
  className?: string;
  /** Larger centered first-message style */
  large?: boolean;
  placeholder?: string;
}

export function ChatInput({
  className = "",
  large = false,
  placeholder = "Type a message...",
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, streaming, stopping, stopStreaming, stagedChatInput, stageChatInput } = useChatStore();

  const setInput = stageChatInput;

  useEffect(() => {
    const handler = (e: CustomEvent<{ content: string; position: "start" | "end" }>) => {
      const { content, position } = e.detail;
      setInput((prev) => (prev ? content + "\n" + prev : content));
    };
    document.addEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
    return () => document.removeEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
  }, []);
  const turnActive = streaming || stopping;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [stagedChatInput, autoResize]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stagedChatInput.trim()) return;
    sendMessage(stagedChatInput);
    setInput("");
    inputRef.current?.focus();
  };

  const inputClass = large
    ? "flex-1 rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50 resize-none min-h-[52px] max-h-[160px] overflow-y-auto [overscroll-behavior:contain]"
    : "flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50 resize-none min-h-[38px] max-h-[160px] overflow-y-auto [overscroll-behavior:contain]";

  return (
    <form onSubmit={handleSubmit} className={className || "p-4 border-t border-zinc-800"}>
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={stagedChatInput}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          rows={1}
          className={inputClass}
        />
        {turnActive ? (
          <button
            type="button"
            onClick={stopStreaming}
            disabled={stopping}
            className={`px-3 py-2 rounded-lg text-white text-sm flex items-center gap-1.5 transition-colors shrink-0 ${
              stopping
                ? "bg-red-600/40 cursor-not-allowed animate-pulse"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            <Square size={14} fill="currentColor" />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!stagedChatInput.trim()}
            className={`px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
              large ? "py-3 px-4" : ""
            }`}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </form>
  );
}
