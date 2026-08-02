import { resolve } from "node:path";
import { platform } from "node:os";

/** Renders an elapsed duration in adaptive human-readable units. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatRuntimeInfo(input: {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  sessionId?: string;
  now?: Date;
  turnStart?: Date;
}): string {
  const now = input.now ?? new Date();
  const lines = [
    "## Runtime",
    `- workspace_root: ${input.workspaceRoot}`,
    `- mode: ${input.mode}`,
    `- data_dir: ${resolve(input.dataDir)}`,
    `- os: ${platform()}`,
  ];
  if (input.sessionId?.trim()) lines.push(`- session_id: ${input.sessionId.trim()}`);
  lines.push(`- datetime: ${now.toISOString()}`);
  if (input.turnStart) {
    const elapsedMs = Math.max(0, now.getTime() - input.turnStart.getTime());
    lines.push(`- turn_elapsed: ${formatElapsed(elapsedMs)}`);
  }
  return lines.join("\n");
}
