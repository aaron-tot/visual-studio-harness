import { useToastStore } from "../../stores/toast";

/** Minimal transient confirmation toast (e.g. "Saved") rendered bottom-right. */
export function Toaster() {
  const visible = useToastStore((s) => s.visible);
  const message = useToastStore((s) => s.message);
  if (!visible) return null;
  return (
    <div
      data-testid="toast"
      className="fixed bottom-4 right-4 z-[120] px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-zinc-900/95 text-xs text-emerald-300 shadow-xl animate-[fade-in_0.15s_ease-out]"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
