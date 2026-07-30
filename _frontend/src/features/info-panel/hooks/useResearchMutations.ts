import { useCallback, useState } from "react";
import {
  createResearchViaApi,
  deleteResearchViaApi,
  updateResearchViaApi,
} from "../../../lib/api";
import type { ResearchDoc } from "../../../lib/api";
import type { DesignLocation, PlanScope } from "../types";
import { scopeApiParams } from "../lib/scope-params";

interface UseResearchMutationsOptions {
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

export function useResearchMutations({
  scope,
  workspaceRoot,
  sessionId,
  onSuccess,
}: UseResearchMutationsOptions) {
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

  const create = useCallback(
    async (name: string, document: ResearchDoc) => {
      const loc = createLocation(scope, workspaceRoot, sessionId);
      const blocked = requireLocation(loc);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      if (!name.trim() || !document?.meta) return false;

      return run(async () => {
        await createResearchViaApi({
          name: name.trim(),
          document,
          ...paramsOf(loc),
        });
        setResult(`Research "${name.trim()}" created`);
      });
    },
    [scope, workspaceRoot, sessionId, requireLocation, paramsOf, run]
  );

  const update = useCallback(
    async (docName: string, location: DesignLocation, document: ResearchDoc) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await updateResearchViaApi({
          name: docName,
          document,
          ...paramsOf(location),
        });
        setResult(`Research "${docName}" saved`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const remove = useCallback(
    async (docName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await deleteResearchViaApi({
          name: docName,
          ...paramsOf(location),
        });
        setResult(`"${docName}" deleted`);
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
    update,
    remove,
  };
}
