/**
 * QuestionPart
 *
 * Renders suggested follow-up questions as clickable cards.
 * When clicked, the question is sent as a new message.
 * Matches OpenCode's "question" part type for suggested prompts.
 */

import { MessageCircle } from "lucide-react";
import { cn } from "../../../lib/utils";

interface QuestionPartProps {
  questions: string[];
  /** Called when user clicks a suggested question */
  onAsk?: (question: string) => void;
  className?: string;
}

export function QuestionPart({ questions, onAsk, className }: QuestionPartProps) {
  if (!questions.length) return null;

  return (
    <div className={cn("my-2 space-y-1.5", className)}>
      {questions.map((q, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onAsk?.(q)}
          disabled={!onAsk}
          className={cn(
            "flex items-start gap-2 w-full text-left px-3 py-2 rounded-lg text-xs",
            "border border-zinc-700/50 bg-zinc-800/30",
            "hover:bg-zinc-800/60 hover:border-zinc-600/50",
            "transition-colors duration-150",
            "disabled:cursor-default disabled:hover:bg-zinc-800/30",
            "group",
          )}
        >
          <MessageCircle
            size={14}
            className="shrink-0 mt-0.5 text-zinc-500 group-hover:text-blue-400 transition-colors"
          />
          <span className="text-zinc-300 group-hover:text-zinc-100 transition-colors leading-relaxed">
            {q}
          </span>
        </button>
      ))}
    </div>
  );
}
