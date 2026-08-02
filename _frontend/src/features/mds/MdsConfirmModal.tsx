import { useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

/** Small confirmation dialog (replaces window.confirm). */
export function MdsConfirmModal({ title, message, confirmLabel = "Delete", onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-[380px] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{message}</p>
        {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-md bg-red-900/60 px-3 py-1.5 text-[11px] text-red-200 hover:bg-red-800/60 disabled:opacity-50"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
