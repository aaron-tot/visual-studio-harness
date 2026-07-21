/**
 * InputActions
 *
 * Send button and supplementary input controls (stop button, etc.)
 * Extracted from ChatInput for reuse in PromptInput composition.
 */

import { Square, Send } from "lucide-react";
import { cn } from "../../../lib/utils";

interface InputActionsProps {
  /** Whether the assistant is currently streaming */
  streaming: boolean;
  /** Whether the input has content to send */
  canSend: boolean;
  /** Called when user clicks send */
  onSend: () => void;
  /** Called when user clicks stop */
  onStop: () => void;
  /** Called when user clicks continue (session with empty input) */
  onContinue?: () => void;
  /** Whether the session has existing messages (shows continue button) */
  hasMessages?: boolean;
  /** Show larger button style (for empty-state composer) */
  large?: boolean;
  className?: string;
}

export function InputActions({
  streaming,
  canSend,
  onSend,
  onStop,
  onContinue,
  hasMessages = false,
  large = false,
  className,
}: InputActionsProps) {
  if (streaming) {
    return (
      <button
        type="button"
        onClick={onStop}
        className={cn(
          "px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm flex items-center gap-1.5 transition-colors shrink-0",
          large && "py-3 px-4",
          className,
        )}
      >
        <Square size={14} fill="currentColor" />
        Stop
      </button>
    );
  }

  if (hasMessages && !canSend && onContinue) {
    return (
      <button
        type="button"
        onClick={onContinue}
        className={cn(
          "px-3 py-2 rounded-lg bg-transparent hover:bg-white/10 text-emerald-500 hover:text-emerald-300 text-sm transition-colors shrink-0 flex items-center gap-1.5",
          large && "py-3 px-4",
          className,
        )}
      >
        <Send size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={!canSend}
      onClick={onSend}
      className={cn(
        "px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-default shrink-0",
        large && "py-3 px-4",
        className,
      )}
    >
      <Send size={16} />
    </button>
  );
}
