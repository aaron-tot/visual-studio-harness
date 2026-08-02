import { useCallback, useEffect, useState } from "react";
import { getMdsScopePaths, type ScopePathsResult } from "../../lib/api";
import { useChatStore } from "../chat/store";
import type { PlanScope } from "../info-panel/types";
import { MdsScopeTree } from "./MdsScopeTree";

const SCOPE_LABELS: Record<PlanScope, string> = {
  global: "Global",
  project: "Workspace",
  session: "Session",
};

const SOURCE_LABELS: Record<ScopePathsResult["dataDirSource"], string> = {
  env: "env override (DATA_DIR)",
  portable: "portable binary",
  installed: "installed package",
  dev: "dev (from source)",
  cwd: "cwd fallback",
};

interface Props {
  scope: PlanScope;
  sessionId?: string;
}

export function MdsScopePaths({ scope, sessionId }: Props) {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const [result, setResult] = useState<ScopePathsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    getMdsScopePaths({ sessionId, workspaceRoot: workspaceRoot || undefined })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, workspaceRoot]);

  useEffect(() => load(), [load, refreshKey]);

  const entry = result?.scopes[scope];

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-zinc-500">
        {error ? (
          <span className="text-red-400">Failed to resolve scope paths: {error}</span>
        ) : result ? (
          <span>
            Runtime: <span className="text-zinc-300">{SOURCE_LABELS[result.dataDirSource]}</span>
            {" · "}
            mode: <span className="text-zinc-300">{result.mode}</span>
          </span>
        ) : (
          <span>Resolving scope path…</span>
        )}
      </div>

      <div className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {SCOPE_LABELS[scope]} directory
        </div>
        <div className="mt-0.5 break-all font-mono text-[11px] text-zinc-100">
          {entry && entry.available ? (
            entry.path
          ) : entry && !entry.available ? (
            <span className="font-sans italic text-zinc-500">{entry.reason}</span>
          ) : (
            "…"
          )}
        </div>
      </div>

      {entry && entry.available && (
        <MdsScopeTree
          scope={scope}
          tree={entry.tree}
          sessionId={sessionId}
          workspaceRoot={workspaceRoot || undefined}
          allTags={entry.tags}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
