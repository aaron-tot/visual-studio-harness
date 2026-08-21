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

/** Message broadcast over WS when a shell emits output or changes status. */
export interface ShellUpdate {
  type: "shell:created" | "shell:updated" | "shell:closed" | "shell:output";
  payload: Record<string, unknown>;
}
