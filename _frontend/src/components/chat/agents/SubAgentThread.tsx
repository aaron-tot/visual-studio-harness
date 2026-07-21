/**
 * SubAgentThread
 *
 * Renders a child agent session inline as a compact, collapsible card.
 * Shows agent name, status, message count, and can expand to show
 * a simplified view of the sub-agent's messages.
 */

import { useState } from "react";
import { ChevronRight, ExternalLink, Users } from "lucide-react";
import { AgentBadge } from "./AgentBadge";
import { StatusDot, type StatusState } from "./StatusDot";
import { generateAgentColors } from "./agent-colors";
import { useConfigStore } from "../../../stores/config";
import { cn } from "../../../lib/utils";

export interface SubAgentMessage {
  role: "user" | "assistant";
  content: string;
}

interface SubAgentThreadProps {
  agentName: string;
  status: StatusState;
  messages?: SubAgentMessage[];
  messageCount?: number;
  sessionId?: string;
  onNavigate?: (sessionId: string) => void;
  className?: string;
}

export function SubAgentThread({
  agentName,
  status,
  messages = [],
  messageCount,
  sessionId,
  onNavigate,
  className,
}: SubAgentThreadProps) {
  const [expanded, setExpanded] = useState(false);
  const { config } = useConfigStore();
  const overrideColor = config.agents?.[agentName]?.color;
  const colors = generateAgentColors(agentName, overrideColor);
  const count = messageCount ?? messages.length;

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden my-1.5 text-xs transition-colors",
        className,
      )}
      style={{
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:opacity-90 transition-opacity"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={cn(
            "text-zinc-400 transition-transform duration-150 shrink-0",
            expanded && "rotate-90",
          )}
        />
        <Users size={12} className="text-zinc-400 shrink-0" />
        <AgentBadge agentName={agentName} compact />
        <span className="text-[10px] text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
          sub-agent
        </span>
        <span className="text-[10px] text-zinc-500">
          {count} {count === 1 ? "message" : "messages"}
        </span>
        <StatusDot status={status} className="ml-auto" />
      </div>

      {/* Expanded messages */}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-2 max-h-64 overflow-y-auto" style={{ borderColor: colors.border }}>
          {messages.length === 0 && (
            <p className="text-[10px] text-zinc-500 italic">No messages to display</p>
          )}
          {messages.filter((m) => m.role !== "system").map((msg, i) => (
            <div key={i} className={cn("text-[11px] leading-relaxed", msg.role === "user" ? "text-zinc-300" : "text-zinc-400")}>
              <span className="font-medium" style={{ color: msg.role === "assistant" ? colors.text : undefined }}>
                {msg.role === "user" ? "You" : agentName}:
              </span>{" "}
              <span className="text-zinc-500 line-clamp-3">{msg.content}</span>
            </div>
          ))}
          {sessionId && onNavigate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate(sessionId); }}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mt-1"
            >
              <ExternalLink size={10} />
              Open in new session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
