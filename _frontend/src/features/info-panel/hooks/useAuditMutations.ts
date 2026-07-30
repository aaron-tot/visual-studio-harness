import { useCallback, useState } from "react";
import { deleteAuditViaApi } from "../../../lib/api";
import type { DesignLocation, PlanScope } from "../types";
import { scopeApiParams } from "../lib/scope-params";

interface UseAuditMutationsOptions {
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

export function useAuditMutations({
  scope,
  workspaceRoot,
  sessionId,
  onSuccess,
}: UseAuditMutationsOptions) {
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

  const remove = useCallback(
    async (auditName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await deleteAuditViaApi({
          name: auditName,
          ...paramsOf(location),
        });
        setResult(`"${auditName}" deleted`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  return {
    busy,
    result,
    setResult,
    clearResult,
    remove,
  };
}
