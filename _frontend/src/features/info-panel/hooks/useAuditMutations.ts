import { useCallback, useState } from "react";
import { deleteAuditViaApi, editAuditViaApi, moveAuditViaApi } from "../../../lib/api";
import type { AuditDocument } from "../../../lib/api";
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

  const edit = useCallback(
    async (
      auditName: string,
      document: AuditDocument,
      location: DesignLocation
    ) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await editAuditViaApi({
          name: auditName,
          document,
          ...paramsOf(location),
        });
        setResult(`"${auditName}" saved`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const move = useCallback(
    async (auditName: string, location: DesignLocation, toScope: PlanScope) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await moveAuditViaApi({
          name: auditName,
          fromScope: location.scope,
          toScope,
          workspaceRoot: workspaceRoot?.trim() || undefined,
          sessionId: sessionId || undefined,
        });
        setResult(`"${auditName}" moved`);
      });
    },
    [requireLocation, paramsOf, run, workspaceRoot, sessionId]
  );

  return {
    busy,
    result,
    setResult,
    clearResult,
    remove,
    edit,
    move,
  };
}
