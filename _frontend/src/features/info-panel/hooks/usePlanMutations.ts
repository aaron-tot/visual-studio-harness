import { useCallback, useState } from "react";
import {
  abandonIdeaViaApi,
  archiveIdeaViaApi,
  createPlanViaApi,
  createSpecViaApi,
  deleteIdeaViaApi,
} from "../../../lib/api";
import type { DesignLocation, DocMode, PlanScope } from "../types";
import { scopeApiParams } from "../lib/scope-params";

interface UsePlanMutationsOptions {
  /** Active scope tab — create always targets current workspace/session under this tab */
  scope: PlanScope;
  workspaceRoot: string | null | undefined;
  sessionId: string | null | undefined;
  onSuccess?: () => void;
}

function createLocation(
  scope: PlanScope,
  workspaceRoot: string | null | undefined,
  sessionId: string | null | undefined
): DesignLocation {
  if (scope === "project") {
    return { scope: "project", workspaceRoot: workspaceRoot?.trim() || undefined };
  }
  if (scope === "session") {
    return { scope: "session", sessionId: sessionId || undefined };
  }
  return { scope: "global" };
}

export function usePlanMutations({
  scope,
  workspaceRoot,
  sessionId,
  onSuccess,
}: UsePlanMutationsOptions) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const clearResult = useCallback(() => setResult(null), []);

  const requireLocation = useCallback(
    (loc: DesignLocation): string | null => {
      if (loc.scope === "session" && !loc.sessionId) return "No active session";
      if (loc.scope === "project" && !loc.workspaceRoot?.trim()) {
        return "No active workspace — set one in the chat toolbar";
      }
      return null;
    },
    []
  );

  const paramsOf = useCallback((loc: DesignLocation) => scopeApiParams(loc), []);

  const run = useCallback(
    async (fn: () => Promise<void>, okMessage?: string) => {
      setBusy(true);
      setResult(null);
      try {
        await fn();
        if (okMessage) setResult(okMessage);
        onSuccess?.();
        return true;
      } catch (err) {
        setResult(`Error: ${err instanceof Error ? err.message : "unknown"}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSuccess]
  );

  /** Create always uses the currently selected scope tab + current workspace/session. */
  const create = useCallback(
    async (mode: DocMode, name: string, endGoal: string) => {
      const loc = createLocation(scope, workspaceRoot, sessionId);
      const blocked = requireLocation(loc);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      if (!name.trim()) return false;

      return run(async () => {
        if (mode === "spec") {
          const res = await createSpecViaApi({
            name: name.trim(),
            endGoal: endGoal.trim(),
            ...paramsOf(loc),
          });
          setResult(`Spec v${res.version} created`);
        } else {
          const res = await createPlanViaApi({
            name: name.trim(),
            endGoal: endGoal.trim(),
            ...paramsOf(loc),
          });
          setResult(`Plan v${res.version} created`);
        }
      });
    },
    [scope, workspaceRoot, sessionId, requireLocation, paramsOf, run]
  );

  /** Mutate a design in a specific group location (not necessarily current). */
  const addVersion = useCallback(
    async (ideaName: string, mode: DocMode, location: DesignLocation, endGoal = "") => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        if (mode === "spec") {
          const res = await createSpecViaApi({
            name: ideaName,
            endGoal,
            ...paramsOf(location),
          });
          setResult(`Spec v${res.version} added to ${ideaName}`);
        } else {
          const res = await createPlanViaApi({
            name: ideaName,
            endGoal,
            ...paramsOf(location),
          });
          setResult(`Plan v${res.version} added to ${ideaName}`);
        }
      });
    },
    [requireLocation, paramsOf, run]
  );

  const abandon = useCallback(
    async (
      ideaName: string,
      reason: string,
      location: DesignLocation,
      successor?: string
    ) => {
      if (!reason.trim()) return false;
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await abandonIdeaViaApi({
          name: ideaName,
          reason: reason.trim(),
          successor: successor?.trim() || undefined,
          ...paramsOf(location),
        });
        setResult(`"${ideaName}" abandoned`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const archiveIdea = useCallback(
    async (ideaName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await archiveIdeaViaApi({
          name: ideaName,
          ...paramsOf(location),
        });
        setResult(`"${ideaName}" archived`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const deleteIdea = useCallback(
    async (ideaName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await deleteIdeaViaApi({
          name: ideaName,
          ...paramsOf(location),
        });
        setResult(`"${ideaName}" deleted`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  return {
    busy,
    result,
    setResult,
    clearResult,
    create,
    addVersion,
    abandon,
    archiveIdea,
    deleteIdea,
    /** Location used for new creates under the active tab */
    createTarget: createLocation(scope, workspaceRoot, sessionId),
  };
}
