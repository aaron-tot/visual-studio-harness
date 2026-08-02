import { useEffect, useState } from "react";
import { getSessionContextConfig, putSessionContextConfig, getScopedContextConfig, putScopedContextConfig } from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { ScopePicker } from "../../features/info-panel/components/ScopePicker";
import type { PlanScope } from "../../features/info-panel/types";

interface ContextPanelProps {
  sessionId?: string;
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const [scope, setScope] = useState<PlanScope>("session");
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  const [maxTurns, setMaxTurns] = useState(10);
  const [loading, setLoading] = useState(true);
  const bumpVer = useChatStore((s) => s.bumpContextConfigVersion);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

  const loadConfig = async () => {
    if (!sessionId && scope === "session") { setLoading(false); return; }
    setLoading(true);
    try {
      let config: { mode: "auto" | "manual"; maxTurns: number; firstTurnNumber: number | null };
      if (scope === "session" && sessionId) {
        config = await getSessionContextConfig(sessionId);
      } else {
        config = await getScopedContextConfig(scope, { workspaceRoot });
      }
      setMode(config.mode ?? "manual");
      setMaxTurns(config.maxTurns ?? 10);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
  }, [scope, sessionId]);

  const save = async (partial: { mode?: "auto" | "manual"; maxTurns?: number }) => {
    const body = { mode: partial.mode ?? mode, maxTurns: partial.maxTurns ?? maxTurns };
    try {
      if (scope === "session" && sessionId) {
        const current = await getSessionContextConfig(sessionId);
        await putSessionContextConfig(sessionId, { ...body, firstTurnNumber: current.firstTurnNumber ?? null });
      } else {
        await putScopedContextConfig(scope, body, { workspaceRoot });
      }
      bumpVer();
      if (partial.mode !== undefined) setMode(partial.mode);
      if (partial.maxTurns !== undefined) setMaxTurns(partial.maxTurns);
    } catch { /* ignore */ }
  };

  const scopePath =
    scope === "global" ? "data/{mode}/context-config.json" :
    scope === "project" ? (workspaceRoot ? `Workspace: ${workspaceRoot}` : "No workspace") :
    sessionId ? `Session: ${sessionId.slice(0, 8)}…` : "No session";

  return (
    <div className="p-4 space-y-6">
      {/* Scope picker — always visible */}
      <div className="flex items-center gap-3">
        <ScopePicker scope={scope} onChange={(s) => setScope(s)} />
        <span className="text-xs text-zinc-600 font-mono">{scopePath}</span>
      </div>

      {/* Override info */}
      <p className="text-xs text-zinc-500">
        Workspace overrides Global. Session overrides Workspace.
      </p>

      {!sessionId && scope === "session" ? (
        <p className="text-sm text-zinc-500">Open a session to configure session-scoped context settings.</p>
      ) : loading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium text-zinc-100 mb-1">
              {mode === "auto" ? "Auto-limit" : "Manual"} Context
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              {scope === "session"
                ? "Settings here override any Project or Global settings."
                : scope === "project"
                ? "Settings here override Global, but can be overridden by Session."
                : "Default settings for all sessions. Can be overridden by Project or Session."}
            </p>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={mode === "auto"}
                onChange={(e) => save({ mode: e.target.checked ? "auto" : "manual" })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-zinc-300">Limit context to last</span>
              <input
                type="number"
                value={maxTurns}
                disabled={mode !== "auto"}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) save({ maxTurns: v });
                }}
                className="w-16 px-2 py-1 text-sm rounded bg-zinc-800 border border-zinc-700 text-zinc-200 disabled:opacity-40"
              />
              <span className="text-sm text-zinc-300">turns</span>
            </label>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <h3 className="text-sm font-medium text-zinc-100 mb-1">Manual</h3>
            <p className="text-xs text-zinc-500">
              When auto-limit is off, drag the handle on the context history line to
              choose exactly which turns are included in the LLM context.
            </p>
          </div>
        </>
      )}
    </div>
  );
}