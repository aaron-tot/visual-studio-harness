/**
 * PromptInput
 *
 * Main prompt composition: combines the text input, agent selector,
 * context indicator, and send/stop controls into a unified floating
 * prompt bar. Replaces the standalone ChatInput in the chat view.
 */

import { useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../../../stores/chat";
import { InjectIndicator } from "../../InjectIndicator";
import { ContextIndicator } from "./ContextIndicator";
import { InputActions } from "./InputActions";
import { PendingActions, type PendingAction } from "./PendingActions";
import { AgentSelector, type AgentOption } from "./AgentSelector";
import { cn } from "../../../lib/utils";

interface PromptInputProps {
  /** Pending actions to display above input */
  pendingActions?: PendingAction[];
  /** Context token usage */
  contextTokens?: { used: number; max: number };
  /** Larger centered first-message style */
  large?: boolean;
  placeholder?: string;
  className?: string;
  /** Available agents for the agent selector */
  agents?: AgentOption[];
  /** Currently selected agent */
  selectedAgent?: AgentOption | null;
  /** Called when agent selection changes */
  onAgentChange?: (agent: AgentOption | null) => void;
  /** Extra controls rendered in the top bar next to the agent selector */
  headerControls?: React.ReactNode;
}

export function PromptInput({
  pendingActions = [],
  contextTokens,
  large = false,
  placeholder = "Type a message...",
  className,
  agents,
  selectedAgent,
  onAgentChange,
  headerControls,
}: PromptInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, streaming, stopStreaming, stagedChatInput, stageChatInput } = useChatStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<{ content: string; position: "start" | "end" }>) => {
      const { content, position } = e.detail;
      setInput((prev) => {
        const next = position === "start"
          ? (prev ? content + "\n" + prev : content)
          : (prev ? prev + "\n" + content : content);
        return next;
      });
    };
    document.addEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
    return () => document.removeEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
  }, []);

  const setInput = stageChatInput;

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [stagedChatInput, autoResize]);

  const handleSubmit = useCallback(() => {
    if (!stagedChatInput.trim()) return;
    sendMessage(stagedChatInput);
    inputRef.current?.focus();
  }, [stagedChatInput, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const inputClass = large
    ? "w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50 resize-none min-h-[52px] max-h-[160px] overflow-y-auto [overscroll-behavior:contain]"
    : "w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50 resize-none min-h-[38px] max-h-[160px] overflow-y-auto [overscroll-behavior:contain]";

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Pending actions */}
      <PendingActions actions={pendingActions} />

      {/* Top controls row */}
      <div className="flex items-center gap-2 px-4 pt-3">
        {agents && agents.length > 0 && (
          <AgentSelector
            agents={agents}
            selectedAgent={selectedAgent || null}
            onSelect={(agent) => onAgentChange?.(agent ?? null)}
          />
        )}
        {headerControls}
      </div>

      {/* Context indicator */}
      {contextTokens && contextTokens.max > 0 && (
        <ContextIndicator used={contextTokens.used} max={contextTokens.max} />
      )}
      {/* Input row */}
      <div className="flex gap-2 items-end px-4 py-3">

        {/* Text input */}
        <div className="flex-1 relative">
          <InjectIndicator />
          <textarea
            ref={inputRef}
            value={stagedChatInput}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className={inputClass}
          />
        </div>

        {/* Send/Stop */}
        <InputActions
          streaming={streaming}
          canSend={stagedChatInput.trim().length > 0}
          onSend={handleSubmit}
          onStop={stopStreaming}
          large={large}
        />
      </div>
    </div>
  );
}
