import type { HookKind, HookStatus } from "./types";
import type { HookName } from "./events";

export interface CatalogEntry {
  name: HookName;
  status: HookStatus;
  kind: HookKind;
  description: string;
}

/**
 * Every known hook. status "reserved" = name frozen, never emit until feature exists.
 */
export const HOOK_CATALOG: readonly CatalogEntry[] = [
  // active
  {
    name: "message.received",
    status: "active",
    kind: "observe",
    description: "User content accepted at start of runTurn",
  },
  {
    name: "message.user_persisted",
    status: "active",
    kind: "observe",
    description: "User message written to session storage",
  },
  {
    name: "turn.start",
    status: "active",
    kind: "observe",
    description: "Session + workspace known; LLM about to run",
  },
  {
    name: "turn.complete",
    status: "active",
    kind: "observe",
    description: "Assistant message persisted (or empty success path)",
  },
  {
    name: "turn.error",
    status: "active",
    kind: "observe",
    description: "Turn failed or empty assistant response",
  },
  {
    name: "stream.start",
    status: "active",
    kind: "observe",
    description: "Before consuming LLM fullStream",
  },
  {
    name: "stream.chunk",
    status: "active",
    kind: "observe",
    description: "Text delta from model (high volume)",
  },
  {
    name: "stream.end",
    status: "active",
    kind: "observe",
    description: "Stream finished; final content available",
  },
  {
    name: "tool.before",
    status: "active",
    kind: "intercept",
    description: "After permission gate, before tool execute",
  },
  {
    name: "tool.after",
    status: "active",
    kind: "observe",
    description: "After tool execute returns",
  },
  {
    name: "tool.error",
    status: "active",
    kind: "observe",
    description: "Tool threw or returned error path",
  },
  {
    name: "session.abort",
    status: "active",
    kind: "observe",
    description: "User cancel / socket close abort",
  },

  // reserved
  {
    name: "message.edit",
    status: "reserved",
    kind: "observe",
    description: "No message-edit feature yet",
  },
  {
    name: "history.truncated",
    status: "reserved",
    kind: "observe",
    description: "No context compression / history prune yet",
  },
  {
    name: "security.prompt_injection",
    status: "reserved",
    kind: "observe",
    description: "No injection detector yet",
  },
  {
    name: "export.before",
    status: "reserved",
    kind: "intercept",
    description: "No chat export yet",
  },
  {
    name: "limits.rate_approach",
    status: "reserved",
    kind: "observe",
    description: "No rate-limit meter yet",
  },
] as const;

const byName = new Map<HookName, CatalogEntry>(
  HOOK_CATALOG.map((e) => [e.name, e])
);

export function getCatalogEntry(name: HookName): CatalogEntry | undefined {
  return byName.get(name);
}

export function isActiveHook(name: HookName): boolean {
  return byName.get(name)?.status === "active";
}

export function isInterceptHook(name: HookName): boolean {
  return byName.get(name)?.kind === "intercept";
}

export function listActiveHooks(): HookName[] {
  return HOOK_CATALOG.filter((e) => e.status === "active").map((e) => e.name);
}

export function listReservedHooks(): HookName[] {
  return HOOK_CATALOG.filter((e) => e.status === "reserved").map((e) => e.name);
}
