import { useChatStore } from "../../stores/chat";

export function SlotWaitingBanner() {
  const waiting = useChatStore((s) => s.slotWaitState);
  const abort = useChatStore((s) => s.abortSlotWait);

  if (!waiting) return null;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-amber-50">
            Waiting for free LLM slot
          </div>
          <div className="text-amber-200/80">
            {waiting.statusMessage || waiting.detail}
          </div>
          <div className="text-[11px] text-amber-200/60">
            {waiting.free}/{waiting.total} free
            {waiting.modelAlias ? ` · ${waiting.modelAlias}` : ""}
            {" · "}
            poll {waiting.pollIntervalSec}s
            {waiting.waitTimeoutSec > 0
              ? ` · timeout ${waiting.waitTimeoutSec}s`
              : " · no timeout"}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md bg-red-800/90 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-red-700"
          onClick={() => abort(waiting.requestId)}
        >
          Force timeout
        </button>
      </div>
    </div>
  );
}
