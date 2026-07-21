/**
 * SubtaskPart
 *
 * Renders a sub-agent task invocation as a compact, collapsible card
 * showing the task label and status. The full sub-agent thread can be
 * expanded in a future iteration.
 */

import { ChevronRight, Users } from "lucide-react";
import { cn } from "../../../lib/utils";

interface SubtaskPartProps {
  label: string;
  status?: "running" | "completed" | "error";
  className?: string;
}

const STATUS_COLORS = {
  running: "border-blue-500/30 bg-blue-500/5",
  completed: "border-green-500/30 bg-green-500/5",
  error: "border-red-500/30 bg-red-500/5",
} as const;

export function SubtaskPart({ label, status = "running", className }: SubtaskPartProps) {
  return (
    <details
      className={cn(
        "group border rounded-lg overflow-hidden my-1.5 text-xs",
        STATUS_COLORS[status],
        className,
      )}
    >
      <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-zinc-800/30 transition-colors">
        <ChevronRight
          size={12}
          className="transition-transform duration-150 group-open:rotate-90 shrink-0 text-zinc-400"
        />
        <Users size={12} className="shrink-0 text-zinc-400" />
        <span className="text-zinc-300 truncate">{label}</span>
        <span className="ml-auto text-[10px] text-zinc-500 uppercase tracking-wide shrink-0">
          {status}
        </span>
      </summary>
      <div className="px-3 py-2 text-[11px] text-zinc-500 border-t border-zinc-700/30">
        Sub-agent task: {label}
      </div>
    </details>
  );
}
