import { useState, useEffect } from "react";

interface RetryCountdownProps {
  attempt: number;
  maxAttempts: number;
  totalDelayMs: number;
  remainingMs: number;
  errorLabel: string;
}

export function RetryCountdown({
  attempt,
  maxAttempts,
  totalDelayMs,
  remainingMs,
  errorLabel,
}: RetryCountdownProps) {
  const [currentRemainingMs, setCurrentRemainingMs] = useState(remainingMs);

  useEffect(() => {
    setCurrentRemainingMs(remainingMs);
  }, [remainingMs]);

  const progress = totalDelayMs > 0 ? Math.max(0, Math.min(1, 1 - currentRemainingMs / totalDelayMs)) : 0;
  const remainingSeconds = Math.ceil(currentRemainingMs / 1000);

  return (
    <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2 my-1">
      <div className="flex items-center gap-2 text-xs text-amber-400/90">
        <span className="font-mono">↻</span>
        <span>Retry attempt {attempt}/{maxAttempts}</span>
        <span className="text-amber-500/60">—</span>
        <span>{errorLabel}</span>
        <span className="text-amber-500/60">—</span>
        <span className="font-mono tabular-nums">
          retrying in {remainingSeconds}s…
        </span>
      </div>
      <div className="mt-1.5 h-1 bg-amber-500/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500/60 transition-all duration-1000 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
