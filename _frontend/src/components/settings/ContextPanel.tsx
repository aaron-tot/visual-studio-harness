import { useEffect, useState } from "react";
import { getSessionContextConfig, putSessionContextConfig, getScopedContextConfig, putScopedContextConfig } from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { ScopePicker } from "../../features/info-panel/components/ScopePicker";
import type { PlanScope } from "../../features/info-panel/types";
import { SummarizationCard } from "./SummarizationCard";

interface ContextPanelProps {
  sessionId?: string;
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const [scope, setScope] = useState<PlanScope>("session");
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  const [autoMaxTurns, setAutoMaxTurns] = useState(10);
  const [manualTurnsBack, setManualTurnsBack] = useState(10);
  const [summarizationModel, setSummarizationModel] = useState<string | undefined>();
  const [summarizationFallbackModel, setSummarizationFallbackModel] = useState<string | undefined>();
  const [summarizationPromptMd, setSummarizationPromptMd] = useState<string | undefined>();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const bumpVer = useChatStore((s) => s.bumpContextConfigVersion);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

  const loadConfig = async () => {
    if (!sessionId && scope === "session") { setLoading(false); return; }
    setLoading(true);
    try {
      let config: {
        mode: "auto" | "manual"; maxTurns: number; firstTurnNumber: number | null; enabled?: boolean;
        summarizationModel?: string; summarizationFallbackModel?: string; summarizationPromptMd?: string;
      };
      if (scope === "session" && sessionId) {
        config = await getSessionContextConfig(sessionId);
      } else {
        config = await getScopedContextConfig(scope, { workspaceRoot });
      }
      setMode(config.mode ?? "manual");
      setAutoMaxTurns(config.maxTurns ?? 10);
      setEnabled(scope === "global" ? true : (config.enabled ?? false));
      setSummarizationModel(config.summarizationModel);
      setSummarizationFallbackModel(config.summarizationFallbackModel);
      setSummarizationPromptMd(config.summarizationPromptMd);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
  }, [scope, sessionId]);

  const save = async (partial: {
    mode?: "auto" | "manual"; autoMaxTurns?: number; manualTurnsBack?: number; manualMode?: "turnsBack" | "pinned";
    enabled?: boolean;
    summarizationModel?: string | null; summarizationFallbackModel?: string | null; summarizationPromptMd?: string | null;
  }) => {
    const body: Record<string, unknown> = {
      mode: partial.mode ?? mode,
      maxTurns: partial.autoMaxTurns ?? autoMaxTurns,
    };
    if (partial.enabled !== undefined) body.enabled = partial.enabled;
    if (partial.summarizationModel !== undefined) body.summarizationModel = partial.summarizationModel;
    if (partial.summarizationFallbackModel !== undefined) body.summarizationFallbackModel = partial.summarizationFallbackModel;
    if (partial.summarizationPromptMd !== undefined) body.summarizationPromptMd = partial.summarizationPromptMd;
    try {
      if (scope === "session" && sessionId) {
        const current = await getSessionContextConfig(sessionId);
        const manualMode = partial.manualMode ?? (current.manualMode ?? "turnsBack");
        const manualTurnsBack = partial.manualTurnsBack ?? current.manualTurnsBack ?? 10;
        await putSessionContextConfig(sessionId, {
          ...(body as { mode: "auto" | "manual"; maxTurns: number }),
          enabled: partial.enabled !== undefined ? partial.enabled : (current.enabled ?? true),
          firstTurnNumber: current.firstTurnNumber ?? null,
          manualMode,
          manualTurnsBack,
          summarizationModel: partial.summarizationModel !== undefined ? partial.summarizationModel : current.summarizationModel,
          summarizationFallbackModel: partial.summarizationFallbackModel !== undefined ? partial.summarizationFallbackModel : current.summarizationFallbackModel,
          summarizationPromptMd: partial.summarizationPromptMd !== undefined ? partial.summarizationPromptMd : current.summarizationPromptMd,
        });
      } else {
        await putScopedContextConfig(scope, body, { workspaceRoot });
      }
      bumpVer();
      if (partial.mode !== undefined) setMode(partial.mode);
      if (partial.autoMaxTurns !== undefined) setAutoMaxTurns(partial.autoMaxTurns);
      if (partial.manualTurnsBack !== undefined) setManualTurnsBack(partial.manualTurnsBack);
      if (partial.enabled !== undefined) setEnabled(partial.enabled);
      if (partial.summarizationModel !== undefined) setSummarizationModel(partial.summarizationModel ?? undefined);
      if (partial.summarizationFallbackModel !== undefined) setSummarizationFallbackModel(partial.summarizationFallbackModel ?? undefined);
      if (partial.summarizationPromptMd !== undefined) setSummarizationPromptMd(partial.summarizationPromptMd ?? undefined);
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
          {/* Override toggle — workspace & session scopes only */}
          {scope !== "global" && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => save({ enabled: e.target.checked })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-zinc-300">
                Use custom settings for this {scope === "session" ? "session" : "workspace"}
              </span>
            </label>
          )}

          {!enabled ? (
            <p className="text-xs text-zinc-500">
              Disabled — this {scope === "session" ? "session" : "workspace"} inherits its context
              and summarization settings from the {scope === "session" ? "workspace or global" : "global"} scope.
            </p>
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
                value={autoMaxTurns}
                disabled={mode !== "auto"}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) save({ autoMaxTurns: v });
                }}
                className="w-16 px-2 py-1 text-sm rounded bg-zinc-800 border border-zinc-700 text-zinc-200 disabled:opacity-40"
              />
              <span className="text-sm text-zinc-300">turns</span>
            </label>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <h3 className="text-sm font-medium text-zinc-100 mb-1">Manual</h3>
            <p className="text-xs text-zinc-500 mb-3">
              When auto-limit is off, drag the handle on the context history line to
              choose exactly which turns are included in the LLM context.
            </p>

            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-sm text-zinc-300">Limit context to last</span>
              <input
                type="number"
                value={manualTurnsBack}
                disabled={mode === "auto"}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) save({ manualTurnsBack: v });
                }}
                className="w-16 px-2 py-1 text-sm rounded bg-zinc-800 border border-zinc-700 text-zinc-200 disabled:opacity-40"
              />
              <span className="text-sm text-zinc-300">turns back</span>
            </label>

            <p className="text-xs text-zinc-500 mt-2">
              Drag the handle on the context history line to pin to a specific turn,
              or use the numeric input above to set "N turns back" precisely.
            </p>
          </div>

          <SummarizationCard
            sessionId={sessionId}
            workspaceRoot={workspaceRoot}
            model={summarizationModel}
            fallbackModel={summarizationFallbackModel}
            promptMd={summarizationPromptMd}
            onModel={(m) => save({ summarizationModel: m })}
            onFallbackModel={(m) => save({ summarizationFallbackModel: m })}
            onPromptMd={(p) => save({ summarizationPromptMd: p })}
          />
            </>
          )}
        </>
      )}
    </div>
  );
}
