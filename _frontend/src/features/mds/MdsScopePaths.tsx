import { useCallback, useEffect, useState } from "react";
import { getMdsScopePaths, getMdsAgentsFile, type MdsAgentsFile, type ScopePathsResult } from "../../lib/api";
import { useChatStore } from "../chat/store";
import type { PlanScope } from "../info-panel/types";
import { MdsScopeTree } from "./MdsScopeTree";
import { AgentsMdEditModal } from "./AgentsMdEditModal";

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
  const [agents, setAgents] = useState<MdsAgentsFile | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsEditOpen, setAgentsEditOpen] = useState(false);
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
    if (scope === "project") {
      setAgents(null);
      setAgentsError(null);
      getMdsAgentsFile({ sessionId, workspaceRoot: workspaceRoot || undefined })
        .then((r) => {
          if (!cancelled) setAgents(r);
        })
        .catch((e: unknown) => {
          if (!cancelled) setAgentsError(e instanceof Error ? e.message : String(e));
        });
    } else {
      setAgents(null);
      setAgentsError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [scope, sessionId, workspaceRoot]);

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

      {scope === "project" && entry && entry.available && (
        <div className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Project rules · AGENTS.md
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-zinc-100">
                {agents ? (
                  agents.path
                ) : agentsError ? (
                  <span className="font-sans italic text-red-400">{agentsError}</span>
                ) : (
                  "…"
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {agents
                  ? agents.exists
                    ? "Workspace-root rules file, auto-loaded by the agent"
                    : "Does not exist yet — saved on Create"
                  : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAgentsEditOpen(true)}
              disabled={!agents}
              className="shrink-0 rounded bg-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
            >
              {agents?.exists ? "Edit" : "Create"}
            </button>
          </div>
        </div>
      )}

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

      {agentsEditOpen && agents && (
        <AgentsMdEditModal
          path={agents.path}
          initialContent={agents.content}
          sessionId={sessionId}
          workspaceRoot={workspaceRoot || undefined}
          onClose={() => setAgentsEditOpen(false)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
