/**
 * ErrorLogPart
 *
 * Collapsible error log rendered INSIDE the agent bubble. Shows the error
 * details + time of the error and the ordered retry list with each retry's
 * time and outcome (succeeded / failed / pending / aborted).
 * Amber when the turn recovered after retries; red when it ultimately failed.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { RetryEntry } from "../../../_shared/types";
import { cn } from "../../../lib/utils";

interface ErrorLogPartProps {
  message: string;
  raw?: string;
  isCustom?: boolean;
  category?: string;
  timestamp?: string;
  retries?: RetryEntry[];
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** A turn recovered when its last retry entry ended in success. */
export function isRecovered(retries?: RetryEntry[]): boolean {
  if (!retries || retries.length === 0) return false;
  return retries[retries.length - 1].status === "succeeded";
}

const OUTCOME_META: Record<RetryEntry["status"], { label: string; cls: string }> = {
  succeeded: { label: "succeeded", cls: "text-emerald-400/90" },
  failed: { label: "failed", cls: "text-red-400/90" },
  pending: { label: "retrying…", cls: "text-amber-400/90 animate-pulse" },
  aborted: { label: "aborted", cls: "text-zinc-400/80" },
};

export function ErrorLogPart({ message, raw, isCustom, timestamp, retries }: ErrorLogPartProps) {
  const [open, setOpen] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const recovered = isRecovered(retries);
  const nRetries = retries?.length ?? 0;
  const canToggle = !!(isCustom && raw && raw.trim() && raw.trim() !== message.trim());
  const display = canToggle && showRaw ? raw! : message;
  const title = recovered ? `Recovered after ${nRetries} retr${nRetries === 1 ? "y" : "ies"}` : "Error";
  const border = recovered ? "border-amber-500/40 bg-amber-950/30" : "border-red-500/40 bg-red-950/30";
  const text = recovered ? "text-amber-200" : "text-red-200";
  const icon = recovered ? "text-amber-400" : "text-red-400";

  return (
    <div
      className={cn("rounded-md border px-3 py-2 text-sm mt-1", border)}
      data-error-log-part
      role="alert"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} className={cn("shrink-0", icon)} />
        ) : (
          <ChevronRight size={14} className={cn("shrink-0", icon)} />
        )}
        <AlertTriangle size={14} className={cn("shrink-0", icon)} />
        <span className={cn("text-xs font-medium", text)}>{title}</span>
        {timestamp && (
          <span className="ml-auto text-[10px] text-zinc-500 font-mono">{formatTime(timestamp)}</span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="min-w-0 space-y-1">
            <p className={cn("whitespace-pre-wrap break-words leading-relaxed", text)}>{display}</p>
            {canToggle && (
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] transition-colors",
                  recovered ? "text-amber-400/80 hover:text-amber-300" : "text-red-400/80 hover:text-red-300"
                )}
              >
                {showRaw ? "Show friendly message" : "Show raw error"}
              </button>
            )}
          </div>
          {retries && retries.length > 0 && (
            <ul className="space-y-1">
              {retries.map((r, i) => {
                const meta = OUTCOME_META[r.status] ?? OUTCOME_META.pending;
                return (
                  <li key={i} className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span className="font-mono shrink-0">attempt {r.attempt}</span>
                    <span className="min-w-0 truncate">{r.errorLabel}</span>
                    <span className="text-zinc-600 shrink-0">{formatTime(r.errorTime)}</span>
                    {r.wasRetried && (
                      <span className="text-zinc-600 shrink-0">retried in {(r.delayMs / 1000).toFixed(1)}s</span>
                    )}
                    <span className={cn("ml-auto shrink-0 font-medium", meta.cls)}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
