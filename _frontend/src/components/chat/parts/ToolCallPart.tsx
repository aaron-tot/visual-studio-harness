/**
 * ToolCallPart
 *
 * Wraps the existing ToolCallCard in a ToolStatusBorder for color-coded
 * left-border feedback based on tool execution status.
 * For "task" tool calls, renders child (sub-agent) tool calls nested inside,
 * grouping consecutive context tools into a single collapsible group.
 */

import type { MessagePartType, ToolCallStatus } from "../../../../_shared/types";
import { ToolStatusBorder } from "../tools/ToolStatusBorder";
import { ContextToolGroup, groupContextParts } from "../tools/ContextToolGroup";
import { ToolCallCard } from "../../tools/ToolCallCard";
import { ToolErrorCard } from "../tools/ToolErrorCard";
import { TextPart } from "./TextPart";

interface ToolCallPartProps {
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result?: unknown;
  error?: string;
  sessionId?: string | null;
  cacheSummary?: string;
  /** Child tool calls from sub-agent, rendered nested inside the task card */
  childParts?: MessagePartType[];
}

export function ToolCallPart({
  toolCallId,
  toolName,
  status,
  args,
  result,
  error,
  sessionId,
  cacheSummary,
  childParts,
}: ToolCallPartProps) {
  const hasChildren = childParts && childParts.length > 0;

  // Group consecutive context tools within child parts
  const grouped = hasChildren ? groupContextParts(childParts!) : [];

  return (
    <ToolStatusBorder status={status} className="my-1.5">
      <ToolCallCard
        toolCallId={toolCallId}
        toolName={toolName}
        status={status}
        args={args}
        result={result}
        error={error}
        sessionId={sessionId}
        cacheSummary={cacheSummary}
      />
      {/* Nested sub-agent tool calls */}
      {hasChildren && (
        <div className="border-t border-zinc-800/50 px-2 py-1.5 space-y-1 bg-zinc-900/30">
          <div className="flex items-center gap-1.5 px-1 mb-1">
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">sub-agent tools</span>
          </div>
          {grouped.map((child, i) => {
            // Rendered as ContextToolGroup (grouped context tools)
            if (Array.isArray(child)) {
              return <ContextToolGroup key={`group-${i}`} parts={child} />;
            }
            // Single child tool
            if (child.type === "tool") {
              return (
                <ToolStatusBorder key={child.toolCallId || i} status={child.status}>
                  <ToolCallCard
                    toolCallId={child.toolCallId}
                    toolName={child.toolName}
                    status={child.status}
                    args={child.args}
                    result={child.result}
                    error={child.error}
                    sessionId={sessionId}
                  />
                </ToolStatusBorder>
              );
            }
            if (child.type === "text") {
              return <TextPart key={i} content={child.content} />;
            }
            return null;
          })}
        </div>
      )}
    </ToolStatusBorder>
  );
}
