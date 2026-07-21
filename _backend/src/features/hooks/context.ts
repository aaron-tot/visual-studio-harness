import { randomUUID } from "node:crypto";
import type { HookContext, HookSource } from "./types";

export type BuildHookContextInput = {
  dataDir: string;
  source: HookSource;
  turnId?: string;
  sessionId?: string;
  workspaceRoot?: string;
  providerName?: string;
  modelName?: string;
  signal?: AbortSignal;
};

/** Build a HookContext; generates turnId if omitted. */
export function buildHookContext(input: BuildHookContextInput): HookContext {
  return {
    dataDir: input.dataDir,
    source: input.source,
    turnId: input.turnId ?? randomUUID(),
    sessionId: input.sessionId,
    workspaceRoot: input.workspaceRoot,
    providerName: input.providerName,
    modelName: input.modelName,
    signal: input.signal,
  };
}

/** Shallow clone with overrides (e.g. sessionId known after create). */
export function withHookContext(
  ctx: HookContext,
  patch: Partial<Omit<HookContext, "turnId" | "dataDir" | "source">> & {
    turnId?: string;
    dataDir?: string;
    source?: HookSource;
  }
): HookContext {
  return { ...ctx, ...patch };
}
