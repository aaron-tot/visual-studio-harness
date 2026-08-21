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
