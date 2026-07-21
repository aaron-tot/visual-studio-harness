/**
 * AgentBadge
 *
 * Displays an agent's name with its auto-generated accent color.
 * Shows a single-character initial circle + full name.
 * Used in agent card headers and agent selector dropdowns.
 */

import { generateAgentColors, getAgentInitial } from "./agent-colors";
import { StatusDot, type StatusState } from "./StatusDot";
import { useConfigStore } from "../../../stores/config";
import { cn } from "../../../lib/utils";

interface AgentBadgeProps {
  agentName: string;
  status?: StatusState;
  /** Show only the initial circle (compact mode) */
  compact?: boolean;
  className?: string;
}

export function AgentBadge({ agentName, status, compact = false, className }: AgentBadgeProps) {
  const { config } = useConfigStore();
  const overrideColor = config.agents?.[agentName]?.color;
  const colors = generateAgentColors(agentName, overrideColor);
  const initial = getAgentInitial(agentName);

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {/* Initial circle */}
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {initial}
      </span>

      {/* Full name (hidden in compact mode) */}
      {!compact && (
        <span
          className="text-sm font-medium truncate"
          style={{ color: colors.text }}
        >
          {agentName}
        </span>
      )}

      {/* Status dot */}
      {status && <StatusDot status={status} />}
    </div>
  );
}
