import type { ReactNode } from "react";
import { Pin, PinOff } from "lucide-react";
import { dotGridStyle } from "../../styles/shared";
import type { ProximityPanelState } from "../../hooks/useProximityPanel";

interface ProximityRailProps {
  panel: ProximityPanelState;
  /** Fixed inner width matching expanded rail (e.g. 192 or 280) */
  contentWidth: number;
  children: ReactNode;
  /** Optional header actions rendered left of the pin button */
  headerStart?: ReactNode;
  pinTestId?: string;
  pinTitle?: { pinned: string; unpinned: string };
  className?: string;
  /** Skip CSS transition on width (for live resize dragging) */
  noTransition?: boolean;
}

/**
 * Shared edge-rail shell: width animation, dot-grid bg, pin control, click-to-pin.
 */
export function ProximityRail({
  panel,
  contentWidth,
  children,
  headerStart,
  pinTestId,
  pinTitle = { pinned: "Unpin panel", unpinned: "Pin panel open" },
  className = "",
  noTransition = false,
}: ProximityRailProps) {
  const { isOpen, pinned, pin, unpin, railProps, contentProps } = panel;

  return (
    <div
      className={`overflow-hidden shrink-0 bg-zinc-950 ${noTransition ? "" : "transition-[width] duration-300 ease-out"} ${className}`}
      style={railProps.style}
      onMouseEnter={railProps.onMouseEnter}
      onMouseLeave={railProps.onMouseLeave}
    >
      <div
        className="h-full flex flex-col bg-zinc-950 relative"
        style={{ width: contentWidth }}
        onClick={contentProps.onClick}
      >
        <div className="absolute inset-0 opacity-[0.037] pointer-events-none" style={dotGridStyle} />

        <div
          className={`flex items-center border-b border-zinc-800/50 shrink-0 relative z-10 ${
            headerStart ? "justify-between px-3 pt-2 pb-2" : "justify-end px-2 h-8"
          }`}
        >
          {headerStart && (
            <div className="flex items-center gap-1 min-w-0 flex-1">{headerStart}</div>
          )}
          <button
            type="button"
            data-testid={pinTestId}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              if (pinned) unpin();
              else pin();
            }}
            title={pinned ? pinTitle.pinned : pinTitle.unpinned}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>

        {/* Keep children mounted so form/expand state survives auto-hide */}
        <div
          className="flex-1 flex flex-col relative overflow-hidden min-h-0 z-10"
          style={{ visibility: isOpen ? "visible" : "hidden" }}
          aria-hidden={!isOpen}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
