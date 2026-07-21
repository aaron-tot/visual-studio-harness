import type { ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface UsageNodeRowProps {
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  label: ReactNode;
  headline: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}

const depthBg: Record<number, string> = {
  0: "",
  1: "bg-zinc-900/30",
  2: "bg-zinc-900/50",
  3: "bg-zinc-900/60",
  4: "bg-zinc-900/70",
};

/**
 * Collapsible tree row.
 * Only the top header (chevron + label + headline) toggles expand/collapse.
 * Expanded detail body is NOT part of the toggle hit target.
 */
export function UsageNodeRow({
  depth,
  expanded,
  onToggle,
  label,
  headline,
  detail,
  children,
}: UsageNodeRowProps) {
  const indent = depth * 16;
  const padLeft = 8 + indent;

  return (
    <div>
      {/* Header only — this is the toggle */}
      <button
        type="button"
        className={`w-full flex items-start gap-1.5 px-3 py-1.5 hover:bg-zinc-800/60 transition-colors text-left ${depthBg[depth] ?? ""}`}
        style={{ paddingLeft: padLeft }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0 pointer-events-none">
          {expanded ? (
            <ChevronDown size={12} className="text-zinc-500" />
          ) : (
            <ChevronRight size={12} className="text-zinc-500" />
          )}
        </span>
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap pointer-events-none">
          <span className="text-xs font-medium text-zinc-200 whitespace-nowrap">{label}</span>
          <span className="text-[10px] text-zinc-500 leading-relaxed min-w-0 flex-1">
            {headline}
          </span>
        </div>
      </button>

      {/* Detail body — not a toggle; clicks don't collapse the row */}
      {expanded && detail && (
        <div
          className={`px-3 pb-1.5 border-t border-zinc-800/80 ${depthBg[depth] ?? ""}`}
          style={{ paddingLeft: padLeft + 18 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pt-1.5">{detail}</div>
        </div>
      )}

      {expanded && children && (
        <div className="border-l border-zinc-800/60 ml-5">{children}</div>
      )}
    </div>
  );
}
