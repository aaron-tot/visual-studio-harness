/**
 * ToolStatusBorder
 *
 * Wraps any content (typically a tool call card) with a color-coded left border
 * and subtle background tint based on the tool's current status.
 * Provides visual feedback on tool execution state at a glance.
 */

import { type ReactNode } from "react";
import { type ToolCallStatus } from "../../../../_shared/types";
import { getToolStatusColor } from "./tool-status-colors";
import { cn } from "../../../lib/utils";

interface ToolStatusBorderProps {
  status: ToolCallStatus;
  children: ReactNode;
  className?: string;
}

export function ToolStatusBorder({ status, children, className }: ToolStatusBorderProps) {
  const color = getToolStatusColor(status);

  return (
    <div
      className={cn(
        "rounded-lg border-l-[3px] border border-t-zinc-800 border-r-zinc-800 border-b-zinc-800 overflow-hidden transition-colors duration-200",
        className,
      )}
      style={{ borderLeftColor: color.border }}
    >
      {children}
    </div>
  );
}
