import { useCallback, useState } from "react";
import {
  archiveNoteViaApi,
  createNoteViaApi,
  deleteNoteViaApi,
  moveNoteViaApi,
  updateNoteViaApi,
} from "../../../lib/api";
import type { DesignLocation, PlanScope } from "../types";
import { scopeApiParams } from "../lib/scope-params";

interface UseNoteMutationsOptions {
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

export function useNoteMutations({
  scope,
  workspaceRoot,
  sessionId,
  onSuccess,
}: UseNoteMutationsOptions) {
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
    async (name: string, title: string, body: string) => {
      const loc = createLocation(scope, workspaceRoot, sessionId);
      const blocked = requireLocation(loc);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      if (!name.trim() || !title.trim()) return false;

      return run(async () => {
        await createNoteViaApi({
          name: name.trim(),
          title: title.trim(),
          body,
          ...paramsOf(loc),
        });
        setResult(`Note "${name.trim()}" created`);
      });
    },
    [scope, workspaceRoot, sessionId, requireLocation, paramsOf, run]
  );

  const update = useCallback(
    async (noteName: string, location: DesignLocation, title: string, body: string) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await updateNoteViaApi({
          name: noteName,
          title: title.trim(),
          body,
          ...paramsOf(location),
        });
        setResult(`Note "${noteName}" saved`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const archive = useCallback(
    async (noteName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await archiveNoteViaApi({
          name: noteName,
          ...paramsOf(location),
        });
        setResult(`"${noteName}" archived`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const remove = useCallback(
    async (noteName: string, location: DesignLocation) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await deleteNoteViaApi({
          name: noteName,
          ...paramsOf(location),
        });
        setResult(`"${noteName}" deleted`);
      });
    },
    [requireLocation, paramsOf, run]
  );

  const move = useCallback(
    async (noteName: string, location: DesignLocation, toScope: PlanScope) => {
      const blocked = requireLocation(location);
      if (blocked) {
        setResult(blocked);
        return false;
      }
      return run(async () => {
        await moveNoteViaApi({
          name: noteName,
          fromScope: location.scope,
          toScope,
          ...paramsOf(location),
        });
        setResult(`"${noteName}" moved`);
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
    archive,
    remove,
    move,
  };
}
