/**
 * AgentMessageCard
 *
 * Wraps all of an agent's response content (text, tool calls, thinking, etc.)
 * in a visually distinct card with agent-specific coloring. This is the core
 * visual pattern from OpenCode: each agent's turn gets its own themed card.
 *
 * Visual spec:
 * - Left border: 3px solid, agent-specific color
 * - Background: agent-specific subtle tint
 * - Header: agent badge + status dot
 * - Body: scrollable content area
 * - Streaming: pulsing left border animation
 */

import { type ReactNode } from "react";
import { agentColorStyles, generateAgentColors } from "./agent-colors";
import { StatusDot, type StatusState } from "./StatusDot";
import { useConfigStore } from "../../../stores/config";
import { cn } from "../../../lib/utils";

interface AgentMessageCardProps {
  agentName: string;
  status: StatusState;
  /** The message parts rendered inside this card */
  children: ReactNode;
  /** Collapsible for sub-agent results */
  isCollapsible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function AgentMessageCard({
  agentName,
  status,
  children,
  isCollapsible = false,
  isExpanded = true,
  onToggle,
  className,
}: AgentMessageCardProps) {
  const { config } = useConfigStore();
  const overrideColor = config.agents?.[agentName]?.color;
  const colors = generateAgentColors(agentName, overrideColor);

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden",
        status === "streaming" && "animate-pulse-border",
        className,
      )}
      style={{
        ...agentColorStyles(agentName),
        borderColor: "var(--agent-border)",
        backgroundColor: colors.bg,
        boxShadow: `0 1px 3px ${colors.shadow}`,
      }}
    >
      {/* Header row */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b",
          isCollapsible && "cursor-pointer select-none hover:opacity-90",
        )}
        style={{ borderColor: colors.border }}
        onClick={isCollapsible ? onToggle : undefined}
        role={isCollapsible ? "button" : undefined}
        aria-expanded={isCollapsible ? isExpanded : undefined}
      >
        {/* Collapse chevron */}
        {isCollapsible && (
          <svg
            className={cn(
              "w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 shrink-0",
              isExpanded && "rotate-90",
            )}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}

        {/* Agent initial circle */}
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0"
          style={{
            backgroundColor: colors.border,
            color: "white",
          }}
        >
          {agentName.charAt(0).toUpperCase()}
        </span>

        {/* Agent name */}
        <span
          className="text-xs font-medium truncate"
          style={{ color: colors.text }}
        >
          {agentName}
        </span>

        {/* Status */}
        <StatusDot status={status} className="ml-auto" />
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="px-3 py-2 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}
