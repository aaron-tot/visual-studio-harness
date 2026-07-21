/**
 * AgentPart
 *
 * Displays an agent invocation indicator — shown when a sub-agent
 * is started or completes. Uses the AgentBadge for consistent styling.
 */

import { AgentBadge } from "../agents/AgentBadge";
import type { StatusState } from "../agents/StatusDot";
import { cn } from "../../../lib/utils";

interface AgentPartProps {
  name: string;
  status?: StatusState;
  className?: string;
}

export function AgentPart({ name, status = "idle", className }: AgentPartProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-zinc-700/40 bg-zinc-800/40 text-xs my-1",
        className,
      )}
    >
      <AgentBadge agentName={name} status={status} compact />
    </div>
  );
}
