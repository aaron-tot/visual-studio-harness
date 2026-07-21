import { useSessionViewStore } from "../stores/sessionView";

/**
 * Shows when system-prompt inject context is active.
 * SoT: sessionView.sessionContext (same as ContextBar / info-panel inject toggles).
 */
export function InjectIndicator() {
  const active = useSessionViewStore((s) => s.sessionContext.length > 0);
  if (!active) return null;

  return (
    <div className="absolute -top-1.5 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-[8px] text-amber-400 leading-none">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
      inject
    </div>
  );
}
