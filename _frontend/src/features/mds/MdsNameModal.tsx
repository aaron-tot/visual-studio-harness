import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}

/** Modal name input for MDS folder/MD creation + rename (replaces window.prompt). */
export function MdsNameModal({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Create",
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
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
        className="w-[360px] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
        <label className="mt-3 block text-[11px] text-zinc-500">{label}</label>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder={placeholder}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[12px] text-zinc-100 outline-none placeholder-zinc-600 focus:border-zinc-500"
        />
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
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-zinc-700 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
