import { runTurn } from "../agent/turn";
import { registerSession, unregisterSession, getSessionRuntime, getActiveSessions as getActive } from "./runtime";
import type { ConfigFile } from "../../../_shared/types";

export async function startSession(
  dataDir: string,
  config: ConfigFile,
  sessionId: string,
  content: string,
  workspaceRoot?: string,
  agentName?: string,
  providerName?: string,
  modelName?: string,
  thinkingEffort?: string
): Promise<void> {
  await runTurn(dataDir, config, {
    sessionId,
    content,
    workspaceRoot,
    agentName,
    providerName,
    modelName,
    thinkingEffort: thinkingEffort as any,
  });
}

export function cancelSession(sessionId: string): void {
  const runtime = getSessionRuntime(sessionId);
  if (runtime) {
    runtime.abortController.abort();
    unregisterSession(sessionId);
  }
}

export function getActiveSessions(): string[] {
  return getActive();
}
