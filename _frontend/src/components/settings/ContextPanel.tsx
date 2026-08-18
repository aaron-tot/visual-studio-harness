import { useEffect, useState } from "react";
import { getSessionContextConfig, putSessionContextConfig, getScopedContextConfig, putScopedContextConfig } from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { useConfigStore } from "../../stores/config";
import { ScopePicker } from "../../features/info-panel/components/ScopePicker";
import type { PlanScope } from "../../features/info-panel/types";
import { SummarizationCard } from "./SummarizationCard";

interface ContextPanelProps {
  sessionId?: string;
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const [scope, setScope] = useState<PlanScope>("session");
  const [mode, setMode] = useState<"sliding" | "fixed">("fixed");
  const [windowSize, setWindowSize] = useState(10);
  const [pinnedTurn, setPinnedTurn] = useState<number | null>(null);
  const [autoCompactionEnabled, setAutoCompactionEnabled] = useState(false);
  const [autoCompactionTriggerTokens, setAutoCompactionTriggerTokens] = useState(0);
  const [summarizationModel, setSummarizationModel] = useState<string | undefined>();
  const [summarizationFallbackModel, setSummarizationFallbackModel] = useState<string | undefined>();
  const [summarizationPromptMd, setSummarizationPromptMd] = useState<string | undefined>();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  // History inclusion settings (moved from General)
  const [includeFailedTurns, setIncludeFailedTurns] = useState(true);
  const [includeToolCalls, setIncludeToolCalls] = useState(true);
  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [includePatches, setIncludePatches] = useState(false);
  const [includeOtherParts, setIncludeOtherParts] = useState(false);
  const [summarizeIncludePriorSummary, setSummarizeIncludePriorSummary] = useState(true);

  const bumpVer = useChatStore((s) => s.bumpContextConfigVersion);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const config = useConfigStore((s) => s.config);

  const loadConfig = async () => {
    if (!sessionId && scope === "session") { setLoading(false); return; }
    setLoading(true);
    try {
      let ctxConfig: {
        mode: "sliding" | "fixed"; windowSize: number; pinnedTurn: number | null; enabled?: boolean;
        autoCompactionEnabled?: boolean; autoCompactionTriggerTokens?: number;
        summarizationModel?: string; summarizationFallbackModel?: string; summarizationPromptMd?: string;
        includeFailedTurnsInHistory?: boolean;
        includeToolCallsInHistory?: boolean;
        includeReasoningInHistory?: boolean;
        includePatchesInHistory?: boolean;
        includeOtherPartsInHistory?: boolean;
        summarizeIncludePriorSummary?: boolean;
      };
      if (scope === "session" && sessionId) {
        ctxConfig = await getSessionContextConfig(sessionId);
      } else {
        ctxConfig = await getScopedContextConfig(scope, { workspaceRoot });
      }
      setMode(ctxConfig.mode ?? "fixed");
      setWindowSize(ctxConfig.windowSize ?? 10);
      setPinnedTurn(ctxConfig.pinnedTurn ?? null);
      setAutoCompactionEnabled(ctxConfig.autoCompactionEnabled ?? false);
      setAutoCompactionTriggerTokens(ctxConfig.autoCompactionTriggerTokens ?? 0);
      setEnabled(scope === "global" ? true : (ctxConfig.enabled ?? false));
      setSummarizationModel(ctxConfig.summarizationModel);
      setSummarizationFallbackModel(ctxConfig.summarizationFallbackModel);
      setSummarizationPromptMd(ctxConfig.summarizationPromptMd);

      // History inclusion settings
      setIncludeFailedTurns(ctxConfig.includeFailedTurnsInHistory ?? true);
      setIncludeToolCalls(ctxConfig.includeToolCallsInHistory ?? true);
      setIncludeReasoning(ctxConfig.includeReasoningInHistory ?? false);
      setIncludePatches(ctxConfig.includePatchesInHistory ?? false);
      setIncludeOtherParts(ctxConfig.includeOtherPartsInHistory ?? false);
      setSummarizeIncludePriorSummary(ctxConfig.summarizeIncludePriorSummary ?? true);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
  }, [scope, sessionId]);

  const save = async (partial: {
    mode?: "sliding" | "fixed"; windowSize?: number; pinnedTurn?: number | null;
    autoCompactionEnabled?: boolean; autoCompactionTriggerTokens?: number;
    enabled?: boolean;
    summarizationModel?: string | null; summarizationFallbackModel?: string | null; summarizationPromptMd?: string | null;
    includeFailedTurnsInHistory?: boolean;
    includeToolCallsInHistory?: boolean;
    includeReasoningInHistory?: boolean;
    includePatchesInHistory?: boolean;
    includeOtherPartsInHistory?: boolean;
    summarizeIncludePriorSummary?: boolean;
  }) => {
    const body: Record<string, unknown> = {
      mode: partial.mode ?? mode,
      windowSize: partial.windowSize ?? windowSize,
    };
    if (partial.pinnedTurn !== undefined) body.pinnedTurn = partial.pinnedTurn;
    if (partial.autoCompactionEnabled !== undefined) body.autoCompactionEnabled = partial.autoCompactionEnabled;
    if (partial.autoCompactionTriggerTokens !== undefined) body.autoCompactionTriggerTokens = partial.autoCompactionTriggerTokens;
    if (partial.enabled !== undefined) body.enabled = partial.enabled;
    if (partial.summarizationModel !== undefined) body.summarizationModel = partial.summarizationModel;
    if (partial.summarizationFallbackModel !== undefined) body.summarizationFallbackModel = partial.summarizationFallbackModel;
    if (partial.summarizationPromptMd !== undefined) body.summarizationPromptMd = partial.summarizationPromptMd;
    if (partial.includeFailedTurnsInHistory !== undefined) body.includeFailedTurnsInHistory = partial.includeFailedTurnsInHistory;
    if (partial.includeToolCallsInHistory !== undefined) body.includeToolCallsInHistory = partial.includeToolCallsInHistory;
    if (partial.includeReasoningInHistory !== undefined) body.includeReasoningInHistory = partial.includeReasoningInHistory;
    if (partial.includePatchesInHistory !== undefined) body.includePatchesInHistory = partial.includePatchesInHistory;
    if (partial.includeOtherPartsInHistory !== undefined) body.includeOtherPartsInHistory = partial.includeOtherPartsInHistory;
    if (partial.summarizeIncludePriorSummary !== undefined) body.summarizeIncludePriorSummary = partial.summarizeIncludePriorSummary;
    try {
      if (scope === "session" && sessionId) {
        const current = await getSessionContextConfig(sessionId);
        await putSessionContextConfig(sessionId, {
          ...body,
          enabled: partial.enabled !== undefined ? partial.enabled : (current.enabled ?? true),
          summarizationModel: partial.summarizationModel ?? current.summarizationModel ?? undefined,
          summarizationFallbackModel: partial.summarizationFallbackModel ?? current.summarizationFallbackModel ?? undefined,
          summarizationPromptMd: partial.summarizationPromptMd ?? current.summarizationPromptMd ?? undefined,
        });
      } else {
        await putScopedContextConfig(scope, body, { workspaceRoot });
      }
      bumpVer();
      if (partial.mode !== undefined) setMode(partial.mode);
      if (partial.windowSize !== undefined) setWindowSize(partial.windowSize);
      if (partial.pinnedTurn !== undefined) setPinnedTurn(partial.pinnedTurn);
      if (partial.autoCompactionEnabled !== undefined) setAutoCompactionEnabled(partial.autoCompactionEnabled);
      if (partial.autoCompactionTriggerTokens !== undefined) setAutoCompactionTriggerTokens(partial.autoCompactionTriggerTokens);
      if (partial.enabled !== undefined) setEnabled(partial.enabled);
      if (partial.summarizationModel !== undefined) setSummarizationModel(partial.summarizationModel ?? undefined);
      if (partial.summarizationFallbackModel !== undefined) setSummarizationFallbackModel(partial.summarizationFallbackModel ?? undefined);
      if (partial.summarizationPromptMd !== undefined) setSummarizationPromptMd(partial.summarizationPromptMd ?? undefined);
      if (partial.includeFailedTurnsInHistory !== undefined) setIncludeFailedTurns(partial.includeFailedTurnsInHistory);
      if (partial.includeToolCallsInHistory !== undefined) setIncludeToolCalls(partial.includeToolCallsInHistory);
      if (partial.includeReasoningInHistory !== undefined) setIncludeReasoning(partial.includeReasoningInHistory);
      if (partial.includePatchesInHistory !== undefined) setIncludePatches(partial.includePatchesInHistory);
      if (partial.includeOtherPartsInHistory !== undefined) setIncludeOtherParts(partial.includeOtherPartsInHistory);
      if (partial.summarizeIncludePriorSummary !== undefined) setSummarizeIncludePriorSummary(partial.summarizeIncludePriorSummary);
    } catch { /* ignore */ }
  };

  // Changing the context mode (Manual/Auto or sliding/fixed) also enables this
  // scope's overrides so the choice actually takes effect (global is always on).
  const saveMode = async (partial: {
    autoCompactionEnabled?: boolean; mode?: "sliding" | "fixed"; windowSize?: number;
  }) => {
    await save({ ...partial, enabled: scope === "global" ? undefined : true });
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

            {enabled ? (
            <>
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-sm font-medium text-zinc-100 mb-1">Compaction &amp; Summary</h3>
                <p className="text-xs text-zinc-500 mb-3">
                  Choose how context is managed and how summaries are produced. Manual offers the
                  slider / pin; Auto Compaction summarizes automatically once the input context
                  reaches the threshold.
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <button type="button" onClick={() => saveMode({ autoCompactionEnabled: false })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${autoCompactionEnabled ? "border-zinc-700 text-zinc-400 hover:bg-zinc-800" : "border-blue-500 bg-blue-500/10 text-blue-300"}`}>Manual</button>
                  <button type="button" onClick={() => saveMode({ autoCompactionEnabled: true })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${autoCompactionEnabled ? "border-violet-500 bg-violet-500/10 text-violet-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}>Auto Compaction</button>
                </div>
                {autoCompactionEnabled ? (
                  <div>
                    <p className="text-xs text-zinc-400 mb-2">
                      After an agent turn finishes, if the full input context (provider-reported tokens)
                      of the last step is at or above the threshold, it automatically summarizes the
                      conversation and pins context to the new summary. The manual slider / pinning is
                      off while auto compaction is on.
                    </p>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <span className="text-sm text-zinc-300">Trigger at input tokens &ge;</span>
                      <input type="number" min={1000} step={1000} value={autoCompactionTriggerTokens || ""}
                        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ autoCompactionTriggerTokens: Math.max(0, v) }); }}
                        className="w-28 px-2 py-1 text-sm rounded bg-zinc-800 border border-zinc-700 text-zinc-200" />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <button type="button" onClick={() => saveMode({ mode: "sliding" })}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${mode === "sliding" ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}>Sliding</button>
                      <button type="button" onClick={() => saveMode({ mode: "fixed" })}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${mode !== "sliding" ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}>Fixed (Pinned)</button>
                    </div>
                    {mode === "sliding" ? (
                      <label className="flex items-center gap-3 cursor-pointer ml-6 mt-2">
                        <span className="text-sm text-zinc-300">N turns:</span>
                        <input type="number" min={1} max={200} value={windowSize}
                          onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ windowSize: Math.max(1, v) }); }}
                          className="w-16 px-2 py-1 text-sm rounded bg-zinc-800 border border-zinc-700 text-zinc-200" />
                      </label>
                    ) : (
                      <div className="ml-6 mt-2 text-sm text-zinc-500">
                        {pinnedTurn != null ? (
                          <>Pinned to turn {pinnedTurn} — context includes turns from this point forward.</>
                        ) : (
                          <>Pinned to the first message — context includes all turns.</>
                        )}
                        <br />
                        <span className="text-xs">Drag the handle on the history line and click the pin icon to pin to a specific turn.</span>
                      </div>
                    )}
                  </>
                )}

                <SummarizationCard
                  sessionId={sessionId}
                  workspaceRoot={workspaceRoot}
                  model={summarizationModel}
                  fallbackModel={summarizationFallbackModel}
                  promptMd={summarizationPromptMd}
                  includePriorSummary={summarizeIncludePriorSummary}
                  onModel={(m) => save({ summarizationModel: m })}
                  onFallbackModel={(m) => save({ summarizationFallbackModel: m })}
                  onPromptMd={(p) => save({ summarizationPromptMd: p })}
                  onIncludePriorSummary={(v) => save({ summarizeIncludePriorSummary: v })}
                />
              </div>

              {/* General History group */}
              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <h3 className="text-sm font-medium text-zinc-100 mb-1">General History</h3>
                <p className="text-xs text-zinc-500 mb-1">
                  These apply to <span className="text-zinc-300">previous turns only</span> — everything
                  from the current turn is always sent to the model. Turning a part type off removes it
                  from history starting with the next turn. Because the first turn that included it was
                  sent differently, that turn no longer matches the next request, so it (and every turn
                  after it) will miss the provider's prompt cache from that point on.
                </p>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeFailedTurns}
                    onChange={(e) => save({ includeFailedTurnsInHistory: e.target.checked })}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                      Include failed/aborted turns
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      When enabled, turns that ended with an error or were aborted are still sent to the model.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeToolCalls}
                    onChange={(e) => save({ includeToolCallsInHistory: e.target.checked })}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                      Include tool calls and results
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      When enabled, tool calls and their results from previous turns are sent to the model.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeReasoning}
                    onChange={(e) => save({ includeReasoningInHistory: e.target.checked })}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                      Include reasoning/thinking
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      When enabled, reasoning/thinking blocks from previous turns are sent to the model.
                    </div>
                    <div className="text-xs text-amber-500/90 mt-0.5">
                      Caution: disabling this can break reasoning models (e.g. DeepSeek reasoner) that
                      require the previous turn's reasoning to be echoed back. If a turn fails with
                      "reasoning_content ... must be passed back", re-enable this.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includePatches}
                    onChange={(e) => save({ includePatchesInHistory: e.target.checked })}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                      Include patches/diffs
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      When enabled, patches/diffs from previous turns are sent to the model.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeOtherParts}
                    onChange={(e) => save({ includeOtherPartsInHistory: e.target.checked })}
                    className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                      Include other parts
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      When enabled, other part types (snapshots, errors, questions, etc.) from previous turns are sent to the model.
                    </div>
                  </div>
                </label>
              </div>

            </>
            ) : (
              <p className="text-xs text-zinc-500">
                This scope inherits its context, history and summarization settings from the parent
                scope. Turn on "Use custom settings for this {scope === "session" ? "session" : "workspace"}"
                above to configure the Manual / Auto Compaction mode and these settings.
              </p>
            )}
        </>
      )}
    </div>
  );
}
