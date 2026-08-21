/** Shared-shell feature types. */

export type ShellStatus = "starting" | "running" | "stopped" | "error";

/** A shell owned by a session. UI-phase entity; real PTY backends attach later. */
export interface Shell {
  id: string;
  name: string;
  sessionId: string;
  status: ShellStatus;
  createdAt: number;
}
