/**
 * StatusDot
 *
 * A small colored dot indicating status. Used in agent cards, tool calls, and headers.
 * Supports streaming (pulsing) animation.
 */

import { cn } from "../../../lib/utils";

export type StatusState = "streaming" | "completed" | "error" | "idle";

interface StatusDotProps {
  status: StatusState;
  className?: string;
}

const STATUS_STYLES: Record<StatusState, string> = {
  streaming: "bg-blue-400 animate-pulse",
  completed: "bg-green-400",
  error:     "bg-red-400",
  idle:      "bg-zinc-500",
};

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", STATUS_STYLES[status], className)}
      title={status}
    />
  );
}
