import { PanelButton, PanelInput } from "../ui";

interface AbandonFormProps {
  reason: string;
  successor: string;
  busy: boolean;
  onReasonChange: (v: string) => void;
  onSuccessorChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AbandonForm({
  reason,
  successor,
  busy,
  onReasonChange,
  onSuccessorChange,
  onConfirm,
  onCancel,
}: AbandonFormProps) {
  return (
    <div
      className="space-y-1.5 pt-1 border-t border-zinc-800"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] text-amber-600 font-medium">Abandon idea</div>
      <PanelInput
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
      />
      <PanelInput
        placeholder="Successor idea (optional)"
        value={successor}
        onChange={(e) => onSuccessorChange(e.target.value)}
      />
      <div className="flex gap-1">
        <PanelButton
          className="flex-1 py-1 bg-red-900/40 text-red-300 hover:bg-red-900/60"
          disabled={busy || !reason.trim()}
          onClick={onConfirm}
        >
          Confirm abandon
        </PanelButton>
        <PanelButton className="py-1" disabled={busy} onClick={onCancel}>
          Cancel
        </PanelButton>
      </div>
    </div>
  );
}
