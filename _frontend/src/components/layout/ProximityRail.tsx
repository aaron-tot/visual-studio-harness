import type { ReactNode } from "react";
import { Pin, PinOff, X, List, PanelRight } from "lucide-react";
import { dotGridStyle } from "../../styles/shared";
import type { ProximityPanelState } from "../../hooks/useProximityPanel";
import type { ProximitySide } from "../../hooks/useProximityPanel";
import { useMobilePanelStore } from "../../stores/mobilePanel";

interface ProximityRailProps {
  panel: ProximityPanelState;
  /** Which screen edge this rail sits on */
  side: ProximitySide;
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
 * Shared edge shell with two modes:
 * - Desktop (>= lg): an in-flow proximity rail that animates width between
 *   collapsed (5px) and expanded, reveals on mouse proximity, pin to hold.
 * - Mobile/tablet (< lg): a fixed slide-over drawer opened via the edge toggle
 *   buttons; a backdrop closes it on tap. It never writes desktop pin state.
 *
 * Children stay mounted in both modes so form/expand/tab state survives
 * collapse and desktop<->mobile switching.
 */
export function ProximityRail({
  panel,
  side,
  contentWidth,
  children,
  headerStart,
  pinTestId,
  pinTitle = { pinned: "Unpin panel", unpinned: "Pin panel open" },
  className = "",
  noTransition = false,
}: ProximityRailProps) {
  const {
    isOpen,
    pinned,
    pin,
    unpin,
    railProps,
    contentProps,
    isMobile,
    mobileOpen,
    closeMobile,
  } = panel;
  // Which panel is currently the open drawer (single-open invariant).
  const openPanel = useMobilePanelStore((s) => s.openPanel);
  const toggleMobilePanel = useMobilePanelStore((s) => s.toggle);

  const headerNode = (
    <div
      className={`flex items-center border-b border-zinc-800/50 shrink-0 relative z-10 ${
        headerStart ? "justify-between px-3 pt-2 pb-2" : "justify-end px-2 h-8"
      }`}
    >
      {headerStart && (
        <div className="flex items-center gap-1 min-w-0 flex-1">{headerStart}</div>
      )}
      {isMobile ? (
        <button
          type="button"
          aria-label="Close panel"
          data-testid="drawer-close"
          className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 p-2 -m-1"
          onClick={closeMobile}
        >
          <X size={16} />
        </button>
      ) : (
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
      )}
    </div>
  );

  const contentNode = (
    <div className="panel-scope flex-1 flex flex-col relative min-h-0">
      <div className="absolute inset-0 opacity-[0.037] pointer-events-none" style={dotGridStyle} />
      {headerNode}
      {/* Keep children mounted so form/expand state survives auto-hide */}
      <div
        className="flex-1 flex flex-col relative overflow-hidden min-h-0 z-10"
        style={{ visibility: isOpen ? "visible" : "hidden" }}
        aria-hidden={!isOpen}
      >
        {children}
      </div>
    </div>
  );

  // Mobile/tablet: fixed slide-over drawer + backdrop + riding toggle button.
  if (isMobile) {
    const hidden = !mobileOpen;
    // Panel opens to full width minus 50px gap at the far edge.
    // Closed: translate full viewport width so it clears completely.
    const away = hidden
      ? side === "left"
        ? "calc(-100vw)"
        : "calc(100vw)"
      : "0px";
    // Panel spans from its screen edge to 50px before the opposite edge.
    const drawerPos =
      side === "left"
        ? { left: 0, right: 50 }
        : { right: 0, left: 50 };
    // Toggle button: hidden when the OTHER panel is open; otherwise present.
    const showButton = openPanel === null || openPanel === side;
    // Icon rides WITH the panel, maintaining a constant 10px gap from the
    // panel's far edge. Panel edge is at 50px from far edge, so icon sits at 60px.
    const iconDx = mobileOpen
      ? side === "left"
        ? "calc(100vw - 60px)"
        : "calc(-100vw + 60px)"
      : "0px";
    return (
      <>
        <div
          className={`fixed inset-0 z-[55] bg-black/50 transition-opacity lg:hidden ${
            hidden ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
          onClick={closeMobile}
          aria-hidden={hidden}
        />
        <div
          className={`fixed top-0 bottom-0 z-[60] bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out lg:hidden flex flex-col ${className}`}
          style={{ ...drawerPos, transform: `translateX(${away})` }}
        >
          {contentNode}
        </div>
        <button
          type="button"
          aria-label={`Toggle ${side === "left" ? "sidebar" : "info panel"}`}
          data-testid={
            side === "left" ? "mobile-toggle-sidebar" : "mobile-toggle-infopanel"
          }
          onClick={() => toggleMobilePanel(side)}
          className={`lg:hidden fixed z-[70] top-1/2 flex items-center justify-center size-11 rounded-xl border border-zinc-700 bg-zinc-900/90 text-zinc-300 shadow-lg backdrop-blur transition-[transform,color,border-color] duration-300 ease-out ${
            side === "left" ? "left-2" : "right-2"
          } ${mobileOpen ? "text-blue-400 border-blue-600/60" : ""} ${
            showButton ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ marginTop: -22, transform: `translateX(${iconDx})` }}
        >
          {side === "left" ? <List size={20} /> : <PanelRight size={20} />}
        </button>
      </>
    );
  }

  // Desktop: in-flow proximity rail (unchanged behavior).
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
        {contentNode}
      </div>
    </div>
  );
}
