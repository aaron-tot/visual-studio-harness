import type { DesignLocation, PlanScope, ScopeQuery } from "../types";

/** Build API body/query fields for a scope + optional location override. */
export function scopeApiParams(
  q: ScopeQuery | DesignLocation
): {
  scope: PlanScope;
  workspaceRoot?: string;
  sessionId?: string;
} {
  const scope = q.scope;
  if (scope === "project") {
    const workspaceRoot =
      "workspaceRoot" in q && q.workspaceRoot ? String(q.workspaceRoot) : undefined;
    return {
      scope: "project",
      ...(workspaceRoot ? { workspaceRoot } : {}),
    };
  }
  if (scope === "session") {
    const sessionId =
      "sessionId" in q && q.sessionId ? String(q.sessionId) : undefined;
    return {
      scope: "session",
      ...(sessionId ? { sessionId } : {}),
    };
  }
  return { scope: "global" };
}

export function scopeLabel(scope: PlanScope): string {
  if (scope === "project") return "Project";
  if (scope === "session") return "Session";
  return "Global";
}

/** Human-readable save target for the create form. */
export function saveTargetHint(
  scope: PlanScope,
  workspaceRoot?: string | null,
  sessionId?: string | null
): string | null {
  if (scope === "global") return "Saves to global designs";
  if (scope === "project") {
    if (!workspaceRoot?.trim()) return "Set a workspace to save project ideas";
    return `Saves to current workspace`;
  }
  if (scope === "session") {
    if (!sessionId) return "Open a session to save session ideas";
    return "Saves to current session";
  }
  return null;
}
