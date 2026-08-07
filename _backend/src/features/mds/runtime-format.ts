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

interface RuntimeInfoInput {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  now?: Date;
  turnStart?: Date;
}

/**
 * Canonical runtime section — renders the SAME bytes whether it appears in the
 * base system prompt (systemPromptSections.runtime) or the trailing
 * additional_system_info block, so emit-on-change can compare them.
 * No session_id (not deterministic at expected-text generation time).
 */
export function formatRuntimeInfo(input: RuntimeInfoInput): string {
  const now = input.now ?? new Date();
  const lines = [
    "## Runtime",
    `- workspace_root: ${input.workspaceRoot}`,
    `- mode: ${input.mode}`,
    `- data_dir: ${resolve(input.dataDir)}`,
    `- os: ${platform()}`,
    `- datetime: ${now.toISOString()}`,
  ];
  if (input.turnStart) {
    const elapsedMs = Math.max(0, now.getTime() - input.turnStart.getTime());
    lines.push(`- turn_elapsed: ${formatElapsed(elapsedMs)}`);
  }
  return lines.join("\n");
}
