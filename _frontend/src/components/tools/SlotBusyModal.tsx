import { useState } from "react";
import { useChatStore } from "../../stores/chat";

export interface SlotBusyPrompt {
  requestId: string;
  sessionId: string;
  toolCallId?: string;
  detail: string;
  free: number;
  total: number;
  modelAlias?: string;
  baseUrl: string;
  defaultPollIntervalSec: number;
  defaultWaitTimeoutSec: number;
}

interface SlotBusyModalProps {
  prompt: SlotBusyPrompt;
  onClose: () => void;
}

export function SlotBusyModal({ prompt, onClose }: SlotBusyModalProps) {
  const respond = useChatStore((s) => s.respondSlotBusy);
  const [pollSec, setPollSec] = useState(String(prompt.defaultPollIntervalSec || 5));
  const [timeoutSec, setTimeoutSec] = useState(
    String(prompt.defaultWaitTimeoutSec ?? 300)
  );

  const submit = (action: "wait" | "fail" | "cancel") => {
    const poll = parseInt(pollSec, 10);
    const wait = parseInt(timeoutSec, 10);
    respond({
      requestId: prompt.requestId,
      sessionId: prompt.sessionId,
      action,
      pollIntervalSec: !Number.isNaN(poll) && poll > 0 ? poll : undefined,
      waitTimeoutSec: !Number.isNaN(wait) && wait >= 0 ? wait : undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={() => submit("cancel")}
    >
      <div
        className="w-[440px] max-w-[95vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-zinc-100">LLM server is busy</h2>
        <p className="mt-1 text-xs text-zinc-400">
          No free parallel slots for the subagent. The main agent is waiting on this
          decision.
        </p>

        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-xs text-zinc-300 space-y-1">
          <div>
            <span className="text-zinc-500">Slots: </span>
            {prompt.free}/{prompt.total} free
          </div>
          <div>
            <span className="text-zinc-500">Detail: </span>
            {prompt.detail}
          </div>
          {prompt.modelAlias ? (
            <div>
              <span className="text-zinc-500">Loaded: </span>
              {prompt.modelAlias}
            </div>
          ) : null}
          <div className="truncate">
            <span className="text-zinc-500">URL: </span>
            {prompt.baseUrl}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Poll every (sec)</span>
            <input
              type="number"
              min={1}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
              value={pollSec}
              onChange={(e) => setPollSec(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Timeout (sec, 0=forever)</span>
            <input
              type="number"
              min={0}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-600"
            onClick={() => submit("wait")}
          >
            Wait and poll until free
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-800 px-3 py-2 text-sm text-white hover:bg-amber-700"
            onClick={() => submit("fail")}
          >
            Fail now (tell main to try later)
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={() => submit("cancel")}
          >
            Cancel subagent
          </button>
        </div>
      </div>
    </div>
  );
}
