/**
 * Chat streaming debug tracing.
 *
 * Every log is gated behind a single toggle so production traffic stays quiet.
 *
 * Enable  : localStorage.setItem("VISUAL_STUDIO_HARNESS_DEBUG_CHAT", "1")
 * Disable : localStorage.setItem("VISUAL_STUDIO_HARNESS_DEBUG_CHAT", "0")
 * Default : on in dev (import.meta.env.DEV), off in production builds.
 *
 * Inspect the in-memory ring buffer from the console:
 *   window.__chatDebug.log()      // last 400 events
 *   window.__chatDebug.enable()   // flip on
 *   window.__chatDebug.disable()  // flip off
 */

const LS_KEY = "VISUAL_STUDIO_HARNESS_DEBUG_CHAT";
const RING_MAX = 400;

const RING: string[] = [];

function isEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* localStorage unavailable */
  }
  return import.meta.env.DEV;
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function chatDebug(namespace: string, message: string, ...args: unknown[]): void {
  if (!isEnabled()) return;
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[chat:${namespace}] ${message}`;
  // eslint-disable-next-line no-console
  console.debug(`%c${ts} ${line}`, "color:#a78bfa", ...args);
  const serialized = args.length ? ` ${args.map(safeStringify).join(" ")}` : "";
  RING.push(`${ts} ${line}${serialized}`);
  if (RING.length > RING_MAX) RING.shift();
}

declare global {
  interface Window {
    __chatDebug?: {
      log: () => string[];
      enable: () => void;
      disable: () => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__chatDebug = {
    log: () => [...RING],
    enable: () => localStorage.setItem(LS_KEY, "1"),
    disable: () => localStorage.setItem(LS_KEY, "0"),
  };
}
