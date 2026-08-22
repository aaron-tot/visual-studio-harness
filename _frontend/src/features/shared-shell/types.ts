/** Shared-shell feature types. */

export type ShellStatus = "starting" | "running" | "stopped" | "error";

/** A shell owned by a session (mirrors backend Shell). */
export interface Shell {
  id: string;
  name: string;
  sessionId: string;
  status: ShellStatus;
  cwd: string;
  createdAt: number;
}

/** Snapshot of a shell's rendered xterm state (serialized for restore). */
export interface ShellSnapshot {
  cols: number;
  rows: number;
  /** addon-serialize output; written back via term.write() to restore. */
  serialized: string;
  updatedAt: number;
}
