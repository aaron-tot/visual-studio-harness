/**
 * Tool Status Colors
 *
 * Maps each ToolCallStatus to a set of visual tokens (border color, background tint, label).
 * Used by ToolCallCard and ToolStatusBorder to render state-appropriate styling.
 */

import type { ToolCallStatus } from "../../../../_shared/types";

export interface ToolStatusColor {
  /** Left-border / accent color */
  border: string;
  /** Subtle background tint */
  bg: string;
  /** Human-readable label */
  label: string;
  /** Tailwind border class (for static usage) */
  borderClass: string;
  /** Tailwind text class */
  textClass: string;
  /** Tailwind bg class */
  bgClass: string;
}

/** Maps each tool status to its visual tokens */
export const TOOL_STATUS_COLORS: Record<ToolCallStatus, ToolStatusColor> = {
  running: {
    border: "#EAB308",
    bg: "#FEF9C3",
    label: "Running",
    borderClass: "border-yellow-500/60",
    textClass: "text-yellow-300",
    bgClass: "bg-yellow-500/5",
  },
  awaiting_permission: {
    border: "#F97316",
    bg: "#FFF7ED",
    label: "Permission Required",
    borderClass: "border-orange-500/60",
    textClass: "text-orange-300",
    bgClass: "bg-orange-500/5",
  },
  awaiting_config: {
    border: "#8B5CF6",
    bg: "#F5F3FF",
    label: "Config Required",
    borderClass: "border-violet-500/60",
    textClass: "text-violet-300",
    bgClass: "bg-violet-500/5",
  },
  awaiting_question: {
    border: "#3B82F6",
    bg: "#EFF6FF",
    label: "Question",
    borderClass: "border-blue-500/60",
    textClass: "text-blue-300",
    bgClass: "bg-blue-500/5",
  },
  awaiting_agent_change: {
    border: "#06B6D4",
    bg: "#ECFEFF",
    label: "Agent Change",
    borderClass: "border-cyan-500/60",
    textClass: "text-cyan-300",
    bgClass: "bg-cyan-500/5",
  },
  completed: {
    border: "#22C55E",
    bg: "#F0FDF4",
    label: "Completed",
    borderClass: "border-green-500/40",
    textClass: "text-green-300",
    bgClass: "bg-green-500/5",
  },
  error: {
    border: "#EF4444",
    bg: "#FEF2F2",
    label: "Error",
    borderClass: "border-red-500/60",
    textClass: "text-red-300",
    bgClass: "bg-red-500/5",
  },
};

/** Default for unknown statuses */
export const DEFAULT_TOOL_COLOR: ToolStatusColor = {
  border: "#6B7280",
  bg: "#F9FAFB",
  label: "Idle",
  borderClass: "border-zinc-700",
  textClass: "text-zinc-400",
  bgClass: "bg-zinc-500/5",
};

/**
 * Get the color tokens for a given tool status.
 * Falls back to DEFAULT_TOOL_COLOR for unknown statuses.
 */
export function getToolStatusColor(status: ToolCallStatus): ToolStatusColor {
  return TOOL_STATUS_COLORS[status] ?? DEFAULT_TOOL_COLOR;
}
