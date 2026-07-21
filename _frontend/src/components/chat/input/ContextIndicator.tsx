/**
 * ContextIndicator
 *
 * Visual representation of context window usage as a thin progress bar.
 * Color shifts from green → yellow → red as usage increases.
 * Auto-hides when usage is low (<20%). Pulsing animation when critical (>90%).
 */

import { cn } from "../../../lib/utils";

interface ContextIndicatorProps {
  /** Number of tokens used */
  used: number;
  /** Maximum context window size */
  max: number;
  className?: string;
}

/**
 * Returns Tailwind classes for the progress bar based on usage percentage.
 */
function getContextBarStyle(percentage: number): { barColor: string; textColor: string; label: string } {
  if (percentage >= 90) {
    return {
      barColor: "bg-red-500",
      textColor: "text-red-400",
      label: "Critical",
    };
  }
  if (percentage >= 75) {
    return {
      barColor: "bg-orange-500",
      textColor: "text-orange-400",
      label: "High",
    };
  }
  if (percentage >= 50) {
    return {
      barColor: "bg-yellow-500",
      textColor: "text-yellow-400",
      label: "Moderate",
    };
  }
  return {
    barColor: "bg-green-500",
    textColor: "text-green-400",
    label: "OK",
  };
}

export function ContextIndicator({ used, max, className }: ContextIndicatorProps) {
  if (max <= 0) return null;

  const percentage = Math.min(100, Math.round((used / max) * 100));

  // Auto-hide when usage is low
  if (percentage < 20) return null;

  const style = getContextBarStyle(percentage);
  const isCritical = percentage >= 90;
  const isHigh = percentage >= 75;

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1",
        className,
      )}
      title={`${formatTokens(used)} / ${formatTokens(max)} tokens (${style.label})`}
    >
      {/* Bar */}
      <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            style.barColor,
            isCritical && "animate-pulse",
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Label */}
      <span className={cn("text-[10px] tabular-nums shrink-0", style.textColor)}>
        {percentage}%
      </span>
    </div>
  );
}
