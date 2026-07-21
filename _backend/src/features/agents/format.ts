import { resolve } from "node:path";
import { platform } from "node:os";

export function formatRuntimeInfo(input: {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  sessionId?: string;
  now?: Date;
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
  return lines.join("\n");
}
