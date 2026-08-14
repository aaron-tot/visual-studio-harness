import { useState, useMemo } from "react";
import type { MessagePartType } from "../../../../../_shared/types";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../stores/chat";
import { useConfigStore } from "../../../stores/config";
import { ToolCallCard } from "../../tools/ToolCallCard";
import { ToolStatusBorder } from "./ToolStatusBorder";
import { groupByStep } from "./group-by-step";
import { toolBatchLabel } from "./tool-batch-label";
import { ContextToolGroup, getCategory, type GroupCategory } from "./ContextToolGroup";
import { isAdditionalSystemInfoPart, extractSystemInfoContent } from "../system-info";
import { MemoSystemInfoBubble } from "../SystemInfoBubble";

function summarize(parts: MessagePartType[]): string {
  const counts: Record<string, number> = {};
  for (const p of parts) if (p.type === "tool" && p.toolName) counts[p.toolName] = (counts[p.toolName] || 0) + 1;
  return Object.entries(counts).map(([n, c]) => `${c} ${n}${c !== 1 ? "s" : ""}`).join(", ");
}

interface CategoryBucket {
  category: GroupCategory | null;
  parts: MessagePartType[];
}

/**
 * Partition a parallel step's tool parts into category sub-buckets.
 * Because the calls ran in parallel (same step), there is no meaningful order,
 * so we group ALL same-category tools together rather than only consecutive
 * runs. Categories with more than one call become sub-groups; single "other"
 * calls are kept flat.
 */
function groupParallelByCategory(parts: MessagePartType[]): CategoryBucket[] {
  const context: MessagePartType[] = [];
  const changes: MessagePartType[] = [];
  const other: MessagePartType[] = [];
  for (const p of parts) {
    if (p.type !== "tool") continue;
    const cat = getCategory(p.toolName);
    if (cat === "context") context.push(p);
    else if (cat === "changes") changes.push(p);
    else other.push(p);
  }
  const out: CategoryBucket[] = [];
  if (context.length > 1) out.push({ category: "context", parts: context });
  else other.push(...context);
  if (changes.length > 1) out.push({ category: "changes", parts: changes });
  else other.push(...changes);
  if (other.length) out.push({ category: null, parts: other });
  return out;
}

export function StepToolGroup({ parts, toolCacheByCallId }: { parts: MessagePartType[]; toolCacheByCallId?: Record<string, string> }) {
  const [collapsed, setCollapsed] = useState(true);
  // Injections are context, not tool calls — kept aside and rendered as the
  // last grey item(s) in the group.
  const asiParts = parts.filter((p) => isAdditionalSystemInfoPart(p));
  const toolParts = parts.filter((p): p is Extract<MessagePartType, { type: "tool" }> => p.type === "tool" && !isAdditionalSystemInfoPart(p));
  const summary = useMemo(() => summarize(toolParts), [toolParts]);
  const buckets = useMemo(() => groupParallelByCategory(toolParts), [toolParts]);
  const toolCount = toolParts.length;
  const allDone = toolParts.length > 0 && toolParts.every((p) => p.status === "completed" || p.status === "error");
  const someRunning = toolParts.some((p) => p.status === "running");
  const toolExecutionMode = useConfigStore((s) => s.config.toolExecutionMode);

  // All parallel tools in one step share the same prompt-cache hit (their
  // results are batched into a single subsequent SDK call). Read it from the
  // first tool's entry and show it on the group header.
  const firstCallId = toolParts[0]?.toolCallId;
  const cacheText = firstCallId ? toolCacheByCallId?.[firstCallId] : undefined;

  const flatTools = (bucket: CategoryBucket) => {
    return bucket.parts.map((p, i) => {
      if (p.type !== "tool") return null;
      const sessionId = useChatStore.getState().sessionId;
      return (
        <ToolStatusBorder key={p.toolCallId || i} status={p.status}>
          <ToolCallCard toolCallId={p.toolCallId} toolName={p.toolName} status={p.status} args={p.args} result={p.result} error={p.error} sessionId={sessionId} taskId={(p as any).taskId as string | undefined} />
        </ToolStatusBorder>
      );
    });
  };

  return (
    <div className="border border-zinc-500/50 rounded-lg overflow-hidden my-1.5">
      <button
        data-collapsible="true"
        data-collapsible-state={collapsed ? "closed" : "open"}
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-zinc-800/50",
          allDone ? "text-zinc-300" : "text-zinc-200"
        )}
      >
        <span className={cn("transition-transform text-zinc-500 shrink-0", collapsed ? "rotate-0" : "rotate-90")}>&#9654;</span>
        <span className={cn(someRunning && "animate-pulse")}>{toolBatchLabel(toolExecutionMode)}</span>
        {cacheText && (
          <span className="text-[10px] text-zinc-400 font-mono shrink-0" title="Prompt cache hit on next step">
            {cacheText} cache
          </span>
        )}
        <span className="text-zinc-500 ml-auto truncate">{toolCount} calls{summary ? ` · ${summary}` : ""}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-zinc-500/50 px-2 py-1.5 space-y-1.5 bg-zinc-900/30">
          {buckets.map((bucket, bIdx) => {
            if (bucket.category === null) {
              return <div key={`flat-${bIdx}`} className="space-y-1.5">{flatTools(bucket)}</div>;
            }
            return (
              <ContextToolGroup
                key={`sub-${bucket.category}`}
                parts={bucket.parts}
              />
            );
          })}
          {/* Injections render as grey items at the end of the parallel group */}
          {asiParts.map((p, i) => (
            <MemoSystemInfoBubble key={`asi-${i}-${(p as any).toolCallId ?? i}`} content={extractSystemInfoContent(p)} />
          ))}
        </div>
      )}
    </div>
  );
}
