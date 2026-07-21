/**
 * ContextToolGroup
 *
 * Groups consecutive tool calls of the same category (context-gathering,
 * applying changes, or running commands) into a single collapsible group
 * with an animated summary title.
 */

import { useState, useMemo } from "react";
import type { MessagePartType } from "../../../../_shared/types";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../stores/chat";
import { ToolCallCard } from "../../tools/ToolCallCard";
import { ToolStatusBorder } from "./ToolStatusBorder";

const CONTEXT_TOOLS = new Set(["read", "glob", "grep", "list", "search", "find_symbol", "read_symbol"]);
const CHANGES_TOOLS = new Set(["write", "edit", "apply_patch"]);

type GroupCategory = "context" | "changes";

const CATEGORY_LABELS: Record<GroupCategory, { active: string; done: string }> = {
  context: { active: "Gathering context", done: "Gathered context" },
  changes: { active: "Applying changes", done: "Applied changes" },
};

function getCategory(toolName: string): GroupCategory | null {
  if (CONTEXT_TOOLS.has(toolName)) return "context";
  if (CHANGES_TOOLS.has(toolName)) return "changes";
  return null;
}

function summarize(parts: MessagePartType[]): string {
  const counts: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === "tool" && p.toolName) {
      counts[p.toolName] = (counts[p.toolName] || 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return "";
  return entries
    .map(([name, count]) => `${count} ${name}${count !== 1 ? "s" : ""}`)
    .join(", ");
}

export function groupContextParts(parts: MessagePartType[]): (MessagePartType[] | MessagePartType)[] {
  const result: (MessagePartType[] | MessagePartType)[] = [];
  let buffer: MessagePartType[] = [];
  let currentCategory: GroupCategory | null = null;

  const flush = () => {
    if (buffer.length > 1) {
      result.push(buffer);
    } else if (buffer.length === 1) {
      result.push(buffer[0]);
    }
    buffer = [];
    currentCategory = null;
  };

  for (const part of parts) {
    if (part.type === "tool") {
      const cat = getCategory(part.toolName);
      if (cat !== null) {
        if (currentCategory === null) {
          currentCategory = cat;
          buffer.push(part);
        } else if (currentCategory === cat) {
          buffer.push(part);
        } else {
          flush();
          currentCategory = cat;
          buffer.push(part);
        }
        continue;
      }
    }
    flush();
    result.push(part);
  }
  flush();
  return result;
}

function groupCategory(parts: MessagePartType[]): GroupCategory {
  for (const p of parts) {
    if (p.type === "tool" && p.toolName) {
      const cat = getCategory(p.toolName);
      if (cat) return cat;
    }
  }
  return "context";
}

interface ToolGroupProps {
  parts: MessagePartType[];
}

export function ContextToolGroup({ parts }: ToolGroupProps) {
  const [collapsed, setCollapsed] = useState(true);
  const summary = useMemo(() => summarize(parts), [parts]);
  const category = useMemo(() => groupCategory(parts), [parts]);
  const labels = CATEGORY_LABELS[category];

  const allDone = parts.every(
    (p) => p.type === "tool" && (p.status === "completed" || p.status === "error")
  );
  const someRunning = parts.some(
    (p) => p.type === "tool" && p.status === "running"
  );

  return (
    <div className="border border-zinc-700/50 rounded-lg overflow-hidden my-1.5">
      <button
        data-collapsible="true"
        data-collapsible-state={collapsed ? "closed" : "open"}
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
          "hover:bg-zinc-800/50",
          allDone ? "text-zinc-400" : "text-zinc-300"
        )}
      >
        <span className={cn(
          "transition-transform text-zinc-600 shrink-0",
          collapsed ? "rotate-0" : "rotate-90"
        )}>
          &#9654;
        </span>
        <span className={cn(someRunning && "animate-pulse")}>
          {allDone ? labels.done : labels.active}
        </span>
        <span className="text-zinc-600 ml-auto truncate">{summary}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-zinc-800/50 px-2 py-1.5 space-y-1.5 bg-zinc-900/30">
          {parts.map((p, i) => {
            if (p.type === "tool") {
              const sessionId = useChatStore.getState().sessionId;
              return (
                <ToolStatusBorder key={p.toolCallId || i} status={p.status}>
                  <ToolCallCard
                    toolCallId={p.toolCallId}
                    toolName={p.toolName}
                    status={p.status}
                    args={p.args}
                    result={p.result}
                    error={p.error}
                    sessionId={sessionId}
                  />
                </ToolStatusBorder>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
