import type { AgentRuntimeSettings, ThinkingEffort } from "../../../../_shared/types";

export type SubagentConfigAction = "once" | "global" | "cancel";

export interface SubagentConfigResponse {
  action: SubagentConfigAction;
  providerName?: string;
  modelName?: string;
  temperature?: number;
  thinkingEffort?: ThinkingEffort;
  maxSteps?: number;
}

type Pending = {
  resolve: (value: SubagentConfigResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
const DEFAULT_TIMEOUT_MS = 180_000;

export function waitForSubagentConfig(
  requestId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<SubagentConfigResponse> {
  return new Promise((resolve) => {
    const existing = pending.get(requestId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ action: "cancel" });
    }
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ action: "cancel" });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
  });
}

export function resolveSubagentConfig(
  requestId: string,
  value: SubagentConfigResponse
): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(value);
  return true;
}

export function cancelSubagentConfigRequests(): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ action: "cancel" });
    pending.delete(id);
  }
}

export function isSubagentSlotConfigured(settings: AgentRuntimeSettings | undefined): boolean {
  return Boolean(settings?.providerName?.trim() && settings?.modelName?.trim());
}
