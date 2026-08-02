import { useState, useMemo } from "react";
import type { MessagePartType } from "../../../../_shared/types";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../stores/chat";
import { ToolCallCard } from "../../tools/ToolCallCard";
import { ToolStatusBorder } from "./ToolStatusBorder";

export type GroupedParts = MessagePartType[] | MessagePartType;

/**
 * Groups consecutive tool parts that share a stepIndex (the same parallel
 * step) into a single batch array when there is more than one. Items that
 * don't qualify (non-tools, single tools, or tools with no stepIndex) pass
 * through unchanged.
 */
export function groupByStep(parts: MessagePartType[]): GroupedParts[] {
  const out: GroupedParts[] = [];
  let buffer: MessagePartType[] = [];
  let currentStep: number | undefined;

  const flush = () => {
    if (buffer.length > 1) out.push(buffer);
    else if (buffer.length === 1) out.push(buffer[0]);
    buffer = [];
    currentStep = undefined;
  };

  for (const p of parts) {
    if (p.type === "tool" && p.stepIndex != null) {
      if (currentStep === undefined) { currentStep = p.stepIndex; buffer.push(p); continue; }
      if (currentStep === p.stepIndex) { buffer.push(p); continue; }
      flush();
      currentStep = p.stepIndex;
      buffer.push(p);
      continue;
    }
    flush();
    out.push(p);
  }
  flush();
  return out;
}

function summarize(parts: MessagePartType[]): string {
  const counts: Record<string, number> = {};
  for (const p of parts) if (p.type === "tool" && p.toolName) counts[p.toolName] = (counts[p.toolName] || 0) + 1;
  return Object.entries(counts).map(([n, c]) => `${c} ${n}${c !== 1 ? "s" : ""}`).join(", ");
}

export function StepToolGroup({ parts }: { parts: MessagePartType[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const summary = useMemo(() => summarize(parts), [parts]);
  const allDone = parts.every((p) => p.type === "tool" && (p.status === "completed" || p.status === "error"));
  const someRunning = parts.some((p) => p.type === "tool" && p.status === "running");

  return (
    <div className="border border-zinc-700/50 rounded-lg overflow-hidden my-1.5">
      <button
        data-collapsible="true"
        data-collapsible-state={collapsed ? "closed" : "open"}
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-800/50",
          allDone ? "text-zinc-400" : "text-zinc-300"
        )}
      >
        <span className={cn("transition-transform text-zinc-600 shrink-0", collapsed ? "rotate-0" : "rotate-90")}>&#9654;</span>
        <span className={cn(someRunning && "animate-pulse")}>{allDone ? "Ran tools" : "Running tools"}</span>
        <span className="text-zinc-600 ml-auto truncate">{summary}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-zinc-800/50 px-2 py-1.5 space-y-1.5 bg-zinc-900/30">
          {parts.map((p, i) => {
            if (p.type !== "tool") return null;
            const sessionId = useChatStore.getState().sessionId;
            return (
              <ToolStatusBorder key={p.toolCallId || i} status={p.status}>
                <ToolCallCard toolCallId={p.toolCallId} toolName={p.toolName} status={p.status} args={p.args} result={p.result} error={p.error} sessionId={sessionId} />
              </ToolStatusBorder>
            );
          })}
        </div>
      )}
    </div>
  );
}