import { useState, useEffect } from "react";

interface StreamingTimerProps {
  startTime: number | null;
  isStreaming: boolean;
}

export function StreamingTimer({ startTime, isStreaming }: StreamingTimerProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isStreaming || startTime == null) {
      setElapsedMs(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedMs(Date.now() - startTime);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 100);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  if (!isStreaming || startTime == null) return null;

  const seconds = Math.floor(elapsedMs / 1000);
  const milliseconds = elapsedMs % 1000;

  let displayText: string;
  if (seconds < 60) {
    displayText = `${seconds}.${String(milliseconds).padStart(3, "0").slice(0, 1)}s`;
  } else {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    displayText = `${mins}:${String(secs).padStart(2, "0")}`;
  }

  return (
    <span className="text-xs text-zinc-500 font-mono tabular-nums">
      {displayText}
    </span>
  );
}
