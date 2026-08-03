import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getTurnStep } from "../../../../../lib/api";
import { JsonValue } from "../../../../../components/chat/JsonValue";

interface StepIoModalProps {
  sessionId: string;
  turnNumber: number;
  stepIndex: number;
  onClose: () => void;
}

interface StepData {
  step: Record<string, unknown>;
  parts: unknown[];
}

function PrettyJson({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 bg-zinc-800/20 hover:bg-zinc-700/30"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{label}</span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap break-words overflow-auto max-h-[40vh]">
          <JsonValue value={value ?? "—"} />
        </pre>
      )}
    </div>
  );
}

export function StepIoModal({ sessionId, turnNumber, stepIndex, onClose }: StepIoModalProps) {
  const [data, setData] = useState<StepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTurnStep(sessionId, turnNumber, stepIndex)
      .then((res) => {
        if (!cancelled) {
          setData(res as unknown as StepData);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, turnNumber, stepIndex]);

  const rawRequest = (data?.step?.rawRequest) ?? null;
  const rawResponse = (data?.step?.rawResponse) ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-lg border border-zinc-800 flex flex-col max-h-[85vh] w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-zinc-200">
              Step #{stepIndex} Input / Output
            </h2>
            <span className="text-xs text-zinc-500">
              Turn #{turnNumber} · {sessionId.slice(0, 16)}…
            </span>
          </div>
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {loading && <div className="p-6 text-xs text-zinc-500">Loading step data...</div>}
        {error && (
          <div className="p-6">
            <p className="text-xs text-red-400">{error}</p>
            <button type="button" className="mt-3 text-sm text-zinc-400 hover:text-zinc-200" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {data && !loading && !error && (
          <div className="p-4 space-y-3 overflow-auto">
            <div className="grid grid-cols-2 gap-3">
              <PrettyJson label="Input (Request)" value={rawRequest} />
              <PrettyJson label="Output (Response)" value={rawResponse} />
            </div>
            {data.parts && data.parts.length > 0 && (
              <PrettyJson label={`Parts (${data.parts.length})`} value={data.parts} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
