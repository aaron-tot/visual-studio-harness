import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface CollapsibleNodeProps {
  depth?: number;
  expanded: boolean;
  onToggle: () => void;
  /** Left label (e.g. “Turn 2”) */
  label: ReactNode;
  /** Trailing / secondary stats line */
  headline?: ReactNode;
  /** Body shown when expanded — NOT part of the toggle hit target */
  detail?: ReactNode;
  /** Nested collapsible children when expanded */
  children?: ReactNode;
  className?: string;
}

const depthBg: Record<number, string> = {
  0: "",
  1: "bg-zinc-900/30",
  2: "bg-zinc-900/50",
  3: "bg-zinc-900/60",
  4: "bg-zinc-900/70",
};

/**
 * Modular collapsible row for Usage V2.
 * Only the header row toggles; detail and children sit outside the button.
 */
export function CollapsibleNode({
  depth = 0,
  expanded,
  onToggle,
  label,
  headline,
  detail,
  children,
  className = "",
}: CollapsibleNodeProps) {
  const padLeft = 8 + depth * 16;

  return (
    <div className={className}>
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
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap select-text">
          <span className="text-xs font-medium text-zinc-200 whitespace-nowrap">{label}</span>
          {headline != null && (
            <span className="text-[10px] text-zinc-500 leading-relaxed min-w-0 flex-1">
              {headline}
            </span>
          )}
        </div>
      </button>

      {expanded && detail != null && (
        <div
          className={`px-3 pb-1.5 border-t border-zinc-800/80 ${depthBg[depth] ?? ""}`}
          style={{ paddingLeft: padLeft + 18 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pt-1.5">{detail}</div>
        </div>
      )}

      {expanded && children != null && (
        <div className="border-l border-zinc-800/60 ml-5">{children}</div>
      )}
    </div>
  );
}
