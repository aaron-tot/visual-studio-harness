/**
 * TPS Tracker
 *
 * Computes a live tokens-per-second estimate during streaming phases.
 * VSH-calculated: no provider timing exists mid-stream, so estimate tokens as chars/4
 * and measure elapsed time in the backend where deltas are consumed.
 *
 * Uses a rolling window for "current" feel; falls back to cumulative rate
 * during the first window so the number appears immediately.
 */

interface Sample {
  chars: number;
  time: number;
}

interface TpsTracker {
  /** Called on the first delta to start the phase. */
  start: (delta: string, startMs?: number) => void;
  /** Called on each subsequent delta; returns live TPS estimate. */
  add: (delta: string, nowMs: number) => number | undefined;
  /** Called when the phase ends. Returns final avg TPS. */
  end: (nowMs: number) => number | undefined;
  /** Returns true if a phase is currently active. */
  isActive: () => boolean;
}

const CHARS_PER_TOKEN = 4;

/**
 * Creates a new TPS tracker with configurable window.
 * Closure-based, no external dependencies.
 * @param windowMs Rolling window size in ms (default 2000). Smaller = more responsive.
 */
export function createTpsTracker(windowMs = 2000): TpsTracker {
  let active = false;
  let phaseStartMs = 0;
  let cumulativeChars = 0;
  const window: Sample[] = [];

  function pruneWindow(now: number) {
    const cutoff = now - windowMs;
    while (window.length > 0 && window[0].time < cutoff) {
      window.shift();
    }
  }

  function estimateTps(now: number): number | undefined {
    if (!active) return undefined;
    if (cumulativeChars === 0) return 0;

    pruneWindow(now);

    // During the first window, fall back to cumulative rate
    if (now - phaseStartMs < windowMs || window.length < 2) {
      const elapsedSec = (now - phaseStartMs) / 1000;
      if (elapsedSec <= 0) return 0;
      return (cumulativeChars / CHARS_PER_TOKEN) / elapsedSec;
    }

    // Rolling window rate
    const oldest = window[0];
    const newest = window[window.length - 1];
    const deltaChars = newest.chars - oldest.chars;
    const deltaTimeSec = (newest.time - oldest.time) / 1000;
    if (deltaTimeSec <= 0) return 0;
    return (deltaChars / CHARS_PER_TOKEN) / deltaTimeSec;
  }

  return {
    start(delta: string, startMs?: number) {
      if (active) return;
      active = true;
      const now = startMs ?? Date.now();
      phaseStartMs = now;
      cumulativeChars = delta.length;
      window.length = 0;
      window.push({ chars: cumulativeChars, time: now });
    },

    add(delta: string, nowMs: number): number | undefined {
      if (!active) return undefined;
      cumulativeChars += delta.length;
      const now = nowMs;
      window.push({ chars: cumulativeChars, time: now });
      return estimateTps(now);
    },

    end(nowMs: number): number | undefined {
      if (!active) return undefined;
      const now = nowMs;
      const finalTps = estimateTps(now);
      active = false;
      return finalTps;
    },

    isActive() {
      return active;
    },
  };
}

/** Alias for backward compatibility — 2s window for thinking phase */
export const createThinkingTpsTracker = () => createTpsTracker(2000);
