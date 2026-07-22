/**
 * ErrorPart
 *
 * Shows a stream/LLM failure under the agent message bubble.
 * Prefer the custom mapped message when we have one; if isCustom + raw,
 * offer a toggle to inspect the raw SDK text.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../../lib/utils";

interface ErrorPartProps {
  message: string;
  raw?: string;
  isCustom?: boolean;
  className?: string;
}

export function ErrorPart({ message, raw, isCustom, className }: ErrorPartProps) {
  const canToggle = !!(isCustom && raw && raw.trim() && raw.trim() !== message.trim());
  const [showRaw, setShowRaw] = useState(false);

  const display = canToggle && showRaw ? raw! : message;

  return (
    <div
      className={cn(
        "rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200 mt-1",
        className
      )}
      data-error-part
      data-testid="chat-error"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="whitespace-pre-wrap break-words leading-relaxed" data-testid="chat-error-text">
            {display}
          </p>
          {canToggle && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-300 transition-colors"
            >
              {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showRaw ? "Show friendly message" : "Show raw error"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
