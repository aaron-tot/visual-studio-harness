/** Shared-shell backend types. */

export type ShellStatus = "starting" | "running" | "stopped" | "error";

/** A live shell owned by a session (backend view). */
export interface Shell {
  id: string;
  name: string;
  sessionId: string;
  status: ShellStatus;
  cwd: string;
  createdAt: number;
}

/** Snapshot of a shell's rendered xterm state (last live payload snapshot). */
export interface ShellSnapshot {
  cols: number;
  rows: number;
  /** addon-serialize output; written back via term.write() to restore. */
  serialized: string;
  updatedAt: number;
}

/** Message broadcast over WS when a shell emits output or changes status. */
export interface ShellUpdate {
  type: "shell:created" | "shell:updated" | "shell:closed" | "shell:output";
  payload: Record<string, unknown>;
}
