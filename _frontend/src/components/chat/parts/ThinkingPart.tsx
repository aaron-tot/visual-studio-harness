/**
 * ThinkingPart
 *
 * Collapsible card display for the model's thinking/reasoning process.
 * Matches the visual language of ToolCallCard: colored left border,
 * header row with icon + badge, collapsible body content.
 * Purple left border distinguishes reasoning from tool calls (green)
 * and text responses (no border).
 */

import { useRef, useEffect } from "react";
import { Brain } from "lucide-react";
import { cn } from "../../../lib/utils";

interface ThinkingPartProps {
  content: string;
  /** Controlled collapsed state */
  collapsed?: boolean;
  className?: string;
  /** When true, shows "reasoning" badge; when false/undefined, shows "completed" */
  isStreaming?: boolean;
}

const Chevron = () => (
  <span className="inline-block text-zinc-600 shrink-0 transition-transform duration-150 group-open:rotate-90">
    &#9654;
  </span>
);

export function ThinkingPart({ content, collapsed = true, className, isStreaming }: ThinkingPartProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.open = !collapsed;
    }
  }, [collapsed]);

  if (!content) return null;

  return (
    <details
      ref={ref}
      className={cn(
        "group rounded-lg border-l-[3px] border border-t-zinc-800 border-r-zinc-800 border-b-zinc-800 overflow-hidden transition-colors duration-200 my-1.5",
        className
      )}
      style={{ borderLeftColor: "#a78bfa" }}
      open={!collapsed}
    >
      {/* Header — always visible, toggles collapse */}
      <summary className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900/50 cursor-pointer hover:bg-zinc-800/40 select-none transition-colors rounded-lg text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Chevron />
          <Brain size={12} className="shrink-0 text-purple-400" />
          <span className="font-medium text-purple-400">Thinking</span>
        </div>
        <span
          className="uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded shrink-0"
          style={{
            backgroundColor: isStreaming ? "#a78bfa15" : "#22c55e15",
            color: isStreaming ? "#a78bfa" : "#22c55e",
          }}
        >
          {isStreaming ? "reasoning" : "completed"}
        </span>
      </summary>

      {/* Body — reasoning content */}
      <div className="px-3 pb-3 pt-1">
        <div className="px-2 py-2 text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-all font-mono">
          {content}
        </div>
      </div>
    </details>
  );
}
