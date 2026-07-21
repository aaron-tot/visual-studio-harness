import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface CopyButtonProps {
  getPrimaryText: () => string;
  getAllText: () => string;
  className?: string;
}

export function CopyButton({ getPrimaryText, getAllText, className }: CopyButtonProps) {
  const [shiftHeld, setShiftHeld] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const handleClick = useCallback(() => {
    const text = shiftHeld ? getAllText() : getPrimaryText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [shiftHeld, getPrimaryText, getAllText]);

  return (
    <div className={cn("relative inline-flex group/btn", className)}>
      <button
        type="button"
        onClick={handleClick}
        className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50 transition-colors"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 text-[10px] whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none">
        {copied ? "Copied!" : shiftHeld ? "Copy all parts" : "Copy message"}
      </span>
    </div>
  );
}
