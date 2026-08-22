import { ptyHost } from "./pty-client";
import type { ShellSnapshot } from "./types";
import { stripAnsi } from "./command";

export interface ShellOutputOptions {
  limit?: number;
  tail?: boolean;
  lines?: number;
}

export function sliceOutput(raw: string, opts: ShellOutputOptions | undefined): string {
  if (!opts) return raw;
  if (opts.lines !== undefined && opts.lines >= 0) {
    const parts = raw.split("\n");
    return parts.slice(-(Math.min(opts.lines, parts.length - 1) + 1)).join("\n");
  }
  if (opts.limit !== undefined && opts.limit >= 0) {
    if (opts.limit === 0) return "";
    return opts.tail === false ? raw.slice(0, opts.limit) : raw.slice(-opts.limit);
  }
  return raw;
}

export function fetchHostBuffer(id: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (reply: { id: string; type: string; data?: string }) => {
      if (reply.id !== id || reply.type !== "buffer") return;
      done = true;
      ptyHost.off("buffer", handler);
      resolve(reply.data ?? "");
    };
    ptyHost.on("buffer", handler);
    ptyHost.requestBuffer(id);
    setTimeout(() => {
      if (!done) {
        ptyHost.off("buffer", handler);
        resolve(fallback);
      }
    }, 500);
  });
}

export async function formatShellOutput(
  id: string,
  fallback: string,
  opts: ShellOutputOptions | undefined,
  raw: boolean
): Promise<string> {
  const buf = (await fetchHostBuffer(id, fallback)) || "";
  return sliceOutput(raw ? buf : stripAnsi(buf), opts);
}

export function validateSnapshot(snap: {
  cols: number;
  rows: number;
  serialized: string;
}): ShellSnapshot {
  if (!Number.isInteger(snap.cols) || snap.cols < 1) {
    throw new Error("snapshot cols must be a positive integer");
  }
  if (!Number.isInteger(snap.rows) || snap.rows < 1) {
    throw new Error("snapshot rows must be a positive integer");
  }
  if (typeof snap.serialized !== "string" || snap.serialized.length === 0) {
    throw new Error("snapshot serialized content must be a non-empty string");
  }
  return { cols: snap.cols, rows: snap.rows, serialized: snap.serialized, updatedAt: Date.now() };
}

/** Headless xterm snapshot from the PTY host (VS Code XtermSerializer model). */
export function fetchHostSnapshot(id: string): Promise<ShellSnapshot | null> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (reply: {
      id: string;
      type: string;
      data?: string;
      cols?: number;
      rows?: number;
    }) => {
      if (reply.id !== id || reply.type !== "snapshot") return;
      done = true;
      ptyHost.off("snapshot", handler);
      const serialized = reply.data ?? "";
      const cols = reply.cols ?? 0;
      const rows = reply.rows ?? 0;
      if (!serialized || cols < 1 || rows < 1) {
        resolve(null);
        return;
      }
      resolve({ cols, rows, serialized, updatedAt: Date.now() });
    };
    ptyHost.on("snapshot", handler);
    ptyHost.requestSnapshot(id);
    setTimeout(() => {
      if (!done) {
        ptyHost.off("snapshot", handler);
        resolve(null);
      }
    }, 500);
  });
}
