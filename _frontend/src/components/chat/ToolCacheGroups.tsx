import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TurnDetail, StepPart } from "../../../_shared/types/trace";
import { computeToolGroups } from "../../lib/turn-inspector/cache-hit";

interface ToolCacheGroupsProps {
  turn: TurnDetail;
}

export function ToolCacheGroups({ turn }: ToolCacheGroupsProps) {
  const groups = computeToolGroups(turn);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <ToolGroupCard key={group.stepId} group={group} />
      ))}
    </div>
  );
}

function ToolGroupCard({ group }: { group: ReturnType<typeof computeToolGroups>[number] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-zinc-800 rounded-md">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 bg-zinc-800/20 hover:bg-zinc-700/30"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{group.groupLabel}</span>

        {group.cacheHit ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-400">{group.cacheHit.formatted}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300">
              {group.cacheHit.pct}% cache
            </span>
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-zinc-500">
            {group.hasNextStep ? "no cache data" : "final step — no cache hit"}
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-800/50 pt-2">
          {group.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: StepPart }) {
  const args = (tool.data as { args?: unknown } | undefined)?.args;
  const argsPreview = args ? JSON.stringify(args).slice(0, 120) : "—";

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="font-mono text-blue-300 shrink-0">{tool.toolName ?? "unknown"}</span>
      <span className="text-zinc-500 truncate flex-1 min-w-0">{argsPreview}</span>
      {tool.status === "error" && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-red-900/30 text-red-300 shrink-0">error</span>
      )}
    </div>
  );
}
