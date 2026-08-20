import { useMemo, useState } from "react";
import { useConfigStore } from "../../stores/config";
import type { ConfigFile } from "../../../../_shared/types";
import { AgentSelector, type AgentOption } from "../chat/input/AgentSelector";
import { ModelDropdown } from "../chat/ModelDropdown";
import { PricingSettingsCard } from "./PricingSettingsCard";
import { UpdateIndicator } from "./UpdateIndicator";
import { compactDb, type CompactDbResult } from "../../lib/api";

const WINDOW_UNITS = ["seconds", "minutes", "hours"] as const;

const DEFAULT_TOOL_END_PROMPT =
  "<system>It was detected that you ended on a tool call without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>";
const DEFAULT_THINKING_END_PROMPT =
  "<system>It was detected that you ended on a reasoning block without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>";

interface RateLimitConfig {
  enableKey: keyof ConfigFile;
  maxAttemptsKey: keyof ConfigFile;
  windowValueKey: keyof ConfigFile;
  windowUnitKey: keyof ConfigFile;
  promptKey: keyof ConfigFile;
  defaultPrompt: string;
}

function RateLimitRow({
  config,
  onPatch,
  label,
  desc,
  keys,
}: {
  config: ConfigFile;
  onPatch: (patch: Partial<ConfigFile>) => void;
  label: string;
  desc: string;
  keys: RateLimitConfig;
}) {
  const currentPrompt = (config[keys.promptKey] as string | undefined) ?? "";
  const isDefault = currentPrompt === keys.defaultPrompt || !currentPrompt;

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={(config[keys.enableKey] as boolean) ?? false}
          onChange={(e) => onPatch({ [keys.enableKey]: e.target.checked })}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
        />
        <div>
          <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
            {label}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{desc}</div>
        </div>
      </label>

      <div className="ml-7 space-y-2">
        <textarea
          value={currentPrompt}
          onChange={(e) => onPatch({ [keys.promptKey]: e.target.value })}
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono resize-y"
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={isDefault}
            onClick={() => onPatch({ [keys.promptKey]: keys.defaultPrompt })}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Reset to default
          </button>

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Max</span>
            <input
              type="number"
              min={1}
              value={(config[keys.maxAttemptsKey] as number) ?? 5}
              onChange={(e) =>
                onPatch({ [keys.maxAttemptsKey]: Math.max(1, Number(e.target.value)) })
              }
              className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
            />
            <span>times in</span>
            <input
              type="number"
              min={1}
              value={(config[keys.windowValueKey] as number) ?? 1}
              onChange={(e) =>
                onPatch({ [keys.windowValueKey]: Math.max(1, Number(e.target.value)) })
              }
              className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
            />
            <select
              value={(config[keys.windowUnitKey] as string) ?? "minutes"}
              onChange={(e) => onPatch({ [keys.windowUnitKey]: e.target.value })}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            >
              {WINDOW_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StreamRetryConfig {
  enableKey: keyof ConfigFile;
  maxAttemptsKey: keyof ConfigFile;
  windowValueKey: keyof ConfigFile;
  windowUnitKey: keyof ConfigFile;
  baseDelayKey: keyof ConfigFile;
  progressiveDelayKey: keyof ConfigFile;
}

function StreamRetryRow({
  config,
  onPatch,
  label,
  desc,
  keys,
}: {
  config: ConfigFile;
  onPatch: (patch: Partial<ConfigFile>) => void;
  label: string;
  desc: string;
  keys: StreamRetryConfig;
}) {
  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={(config[keys.enableKey] as boolean) ?? true}
          onChange={(e) => onPatch({ [keys.enableKey]: e.target.checked })}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
        />
        <div>
          <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
            {label}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{desc}</div>
        </div>
      </label>

      <div className="ml-7 space-y-2" style={{ opacity: (config[keys.enableKey] as boolean) ?? true ? 1 : 0.5 }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span>Max retries</span>
          <input
            type="number"
            min={0}
            max={20}
            value={(config[keys.maxAttemptsKey] as number) ?? 3}
            onChange={(e) =>
              onPatch({ [keys.maxAttemptsKey]: Math.max(0, Math.min(20, Number(e.target.value))) })
            }
            className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
          />
          <span>in</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={(config[keys.windowValueKey] as number) ?? 1}
            onChange={(e) =>
              onPatch({ [keys.windowValueKey]: Math.max(1, Math.min(1440, Number(e.target.value))) })
            }
            className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
          />
          <select
            value={(config[keys.windowUnitKey] as string) ?? "minutes"}
            onChange={(e) => onPatch({ [keys.windowUnitKey]: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
          >
            {WINDOW_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span>Base delay (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={(config[keys.baseDelayKey] as number) ?? 2000}
            onChange={(e) =>
              onPatch({ [keys.baseDelayKey]: Math.max(0, Math.min(60000, Number(e.target.value))) })
            }
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
          />
          <span>Progressive (+ms/retry)</span>
          <input
            type="number"
            min={0}
            max={30000}
            step={100}
            value={(config[keys.progressiveDelayKey] as number) ?? 3000}
            onChange={(e) =>
              onPatch({ [keys.progressiveDelayKey]: Math.max(0, Math.min(30000, Number(e.target.value))) })
            }
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
          />
          <span className="text-zinc-600">(0 = fixed delay)</span>
        </div>
        <div className="text-[11px] text-zinc-500 font-mono">
          Example: base=2000, progressive=3000 → 2s, 5s, 8s, 11s...
        </div>
      </div>
    </div>
  );
}

function GenerateToolSeedsButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ seeded: string[]; overwritten: string[]; errors: string[] } | null>(null);

  const handleGenerate = async () => {
    if (busy) return;
    const confirmed = confirm(
      "This will regenerate the builtin tool skill guides (skill.md + prompt.json) in data/tools/builtin/ from repo seeds, overwriting any existing guide files. Continue?"
    );
    if (!confirmed) return;

    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/mds/seed-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes: ["global", "project", "session"] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ seeded: [], overwritten: [], errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {busy ? "Generating…" : "Generate tool seeds"}
      </button>
      {result && (
        <div className="text-[11px] space-y-1">
          {result.seeded.length > 0 && (
            <div className="text-green-400">Seeded: {result.seeded.join(", ")}</div>
          )}
          {result.overwritten.length > 0 && (
            <div className="text-amber-400">Overwritten: {result.overwritten.join(", ")}</div>
          )}
          {result.errors.length > 0 && (
            <div className="text-red-400">Errors: {result.errors.join(", ")}</div>
          )}
          {result.seeded.length === 0 && result.overwritten.length === 0 && result.errors.length === 0 && (
            <div className="text-zinc-500">No changes (skills already up to date)</div>
          )}
        </div>
      )}
    </div>
  );
}

function CompactDatabaseSection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompactDbResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompact = async () => {
    if (busy) return;
    if (
      !window.confirm(
        "Compact the database now? All in-flight agent sessions will be stopped first."
      )
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await compactDb();
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <div className="text-sm text-zinc-200">Database compaction</div>
      <div className="text-xs text-zinc-500">
        Shrinks the main database file by removing pages freed when sessions
        were archived or deleted. Takes a few seconds and temporarily needs
        roughly the size of the live database in free space.
      </div>
      <button
        type="button"
        onClick={() => void handleCompact()}
        disabled={busy}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Compacting…" : "Compact database now"}
      </button>
      <div className="text-[11px] text-amber-500/80">
        Stops all running sessions first. No sessions are deleted — it only
        releases disk space from data that is already archived.
      </div>
      {result && (
        <div className="text-[11px] text-emerald-400/90">
          Done — freed {mb(result.freedBytes)} ({result.afterBytes} →{" "}
          {mb(result.afterBytes)}), {result.abortedSessions} session(s) stopped.
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-400/80">Compaction failed: {error}</div>
      )}
    </div>
  );
}

export function GeneralPanel() {
  const { config, update } = useConfigStore();

  const patch = (partial: Partial<ConfigFile>) => {
    const current = useConfigStore.getState().config;
    update({ ...current, ...partial });
  };

  const agentOptions = useMemo<AgentOption[]>(() => {
    if (!config.agents) return [];
    return Object.keys(config.agents).map((id) => ({ id, name: id }));
  }, [config.agents]);

  const selectedDefaultAgent = useMemo<AgentOption | null>(() => {
    if (!config.defaultAgent || !config.agents?.[config.defaultAgent]) return null;
    return { id: config.defaultAgent, name: config.defaultAgent };
  }, [config.defaultAgent, config.agents]);

  const handleDefaultAgentSelect = (agent: AgentOption | null) => {
    if (!agent?.id) {
      patch({ defaultAgent: undefined });
      return;
    }
    const agentCfg = config.agents?.[agent.id];
    patch({
      defaultAgent: agent.id,
      defaultProvider: agentCfg?.providerName || config.defaultProvider,
      defaultModel: agentCfg?.modelName || config.defaultModel,
    });
  };

  const handleDefaultModelSelect = (provider: string, model: string) => {
    patch({ defaultProvider: provider, defaultModel: model });
  };

  return (
    <div className="min-h-0 flex flex-col">
      <h2 className="text-sm font-medium text-zinc-100 mb-4">General Settings</h2>

      <div className="space-y-4">
        {/* Defaults for new chats */}
        <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
          <div className="text-sm text-zinc-200">Defaults for new chats</div>
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">Default Agent</div>
              <AgentSelector
                agents={agentOptions}
                selectedAgent={selectedDefaultAgent}
                onSelect={handleDefaultAgentSelect}
              />
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">Default Model</div>
              <ModelDropdown
                providerName={config.defaultProvider || ""}
                modelName={config.defaultModel || ""}
                onSelect={handleDefaultModelSelect}
              />
            </div>
          </div>
        </div>

        {/* Rate limit rows */}
        <RateLimitRow
          config={config}
          onPatch={patch}
          label="Auto-continue on tool end"
          desc="If the model ends on a tool call without trailing text, automatically nudge it to keep working."
          keys={{
            enableKey: "autoContinueOnToolEnd",
            maxAttemptsKey: "autoContinueOnToolEndMaxAttempts",
            windowValueKey: "autoContinueOnToolEndWindowValue",
            windowUnitKey: "autoContinueOnToolEndWindowUnit",
            promptKey: "autoContinueOnToolEndPrompt",
            defaultPrompt: DEFAULT_TOOL_END_PROMPT,
          }}
        />

        <RateLimitRow
          config={config}
          onPatch={patch}
          label="Auto-continue on thinking end"
          desc="If the model ends on a reasoning block without text or tool calls, automatically nudge it to keep working."
          keys={{
            enableKey: "autoContinueOnThinkingEnd",
            maxAttemptsKey: "autoContinueOnThinkingEndMaxAttempts",
            windowValueKey: "autoContinueOnThinkingEndWindowValue",
            windowUnitKey: "autoContinueOnThinkingEndWindowUnit",
            promptKey: "autoContinueOnThinkingEndPrompt",
            defaultPrompt: DEFAULT_THINKING_END_PROMPT,
          }}
        />

        {/* Provider error auto-retry */}
        <StreamRetryRow
          config={config}
          onPatch={patch}
          label="Auto-retry on provider errors"
          desc="Automatically retry when the upstream provider returns 5xx, timeout, network error, or rate limit. Shows countdown in chat."
          keys={{
            enableKey: "streamRetryEnabled",
            maxAttemptsKey: "streamRetryMaxAttempts",
            windowValueKey: "streamRetryWindowValue",
            windowUnitKey: "streamRetryWindowUnit",
            baseDelayKey: "streamRetryBaseDelayMs",
            progressiveDelayKey: "streamRetryProgressiveDelayMs",
          }}
        />

        {/* Pricing (models.dev) */}
        <PricingSettingsCard />

        {/* Checkbox settings */}
        <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={(config.messagePanelFullWidth as boolean) ?? false}
              onChange={(e) => patch({ messagePanelFullWidth: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                Fullwidth
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                When enabled, the message preview panel (top-right of the chat) opens
                to the full width of the message area instead of a fixed box. Does not
                affect whether the panel is open.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={(config.messagePanelPinnedDefault as boolean) ?? false}
              onChange={(e) => patch({ messagePanelPinnedDefault: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                Pinned by default
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                When enabled, each new session opens the message preview panel and
                keeps it pinned, instead of starting closed.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={(config.showSessionName as boolean) ?? false}
              onChange={(e) => patch({ showSessionName: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                Show session name
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Display the active session's name below the workspace path at the
                top of the chat.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={config.workspaceGraph !== false}
              onChange={(e) => patch({ workspaceGraph: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                Workspace graph
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Index workspace files, symbols, imports and exports into a local
                SQLite database. Enables graph agent tools and manifest injection
                into the system prompt. Requires restart to take effect.
              </div>
            </div>
          </label>

          {/* Tool execution mode */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-200">Tool execution mode</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                How multiple tool calls issued in the same step are executed.
                Sequential runs them one at a time; Parallel lets them run concurrently.
              </div>
            </div>
            <select
              value={config.toolExecutionMode ?? "sequential"}
              onChange={(e) =>
                patch({ toolExecutionMode: e.target.value === "concurrent" ? "concurrent" : "sequential" })
              }
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            >
              <option value="sequential">Sequential</option>
              <option value="concurrent">Parallel</option>
            </select>
          </div>

          {/* Phone UI (mobile/tablet) */}
          <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
            <div className="text-sm text-zinc-200">Phone / Tablet UI</div>
            <div className="text-xs text-zinc-500 mb-2">
              When on screens below 1024px, enable larger text, bigger input area, and larger touch targets.
            </div>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={config.phoneUi?.enabled ?? true}
                onChange={(e) => patch({ phoneUi: { ...config.phoneUi, enabled: e.target.checked } })}
                className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <div>
                <div className="text-sm text-zinc-200 group-hover:text-zinc-100">Enable phone UI</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Scales up message text, input selectors, and input height on mobile/tablet only.
                </div>
              </div>
            </label>

            <div className="ml-7 space-y-3" style={{ opacity: (config.phoneUi?.enabled ?? true) ? 1 : 0.5 }}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-28">Message scale</span>
                <input
                  type="number"
                  min={1}
                  max={2}
                  step={0.05}
                  value={config.phoneUi?.messageFontScale ?? 1.3}
                  onChange={(e) => patch({ phoneUi: { ...config.phoneUi, messageFontScale: Math.max(1, Math.min(2, Number(e.target.value))) } })}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
                />
                <span className="text-xs text-zinc-600">(default 1.3)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-28">UI scale</span>
                <input
                  type="number"
                  min={1}
                  max={2}
                  step={0.05}
                  value={config.phoneUi?.uiFontScale ?? 1.2}
                  onChange={(e) => patch({ phoneUi: { ...config.phoneUi, uiFontScale: Math.max(1, Math.min(2, Number(e.target.value))) } })}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
                />
                <span className="text-xs text-zinc-600">(default 1.2)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-28">Input height</span>
                <input
                  type="number"
                  min={1}
                  max={3}
                  step={0.1}
                  value={config.phoneUi?.inputHeightScale ?? 1.5}
                  onChange={(e) => patch({ phoneUi: { ...config.phoneUi, inputHeightScale: Math.max(1, Math.min(3, Number(e.target.value))) } })}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center"
                />
                <span className="text-xs text-zinc-600">(default 1.5)</span>
              </div>
            </div>
          </div>

          {/* Permission request timeout */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={(config.permissionRequestTimeoutEnabled as boolean) ?? false}
              onChange={(e) => patch({ permissionRequestTimeoutEnabled: e.target.checked })}
              className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                Permission request timeout
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                When enabled, permission prompts will auto-deny after the specified
                time. When disabled, prompts wait indefinitely for user response.
              </div>
            </div>
          </label>

          <div className="ml-7 space-y-2" style={{ opacity: (config.permissionRequestTimeoutEnabled as boolean) ?? false ? 1 : 0.5 }}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Timeout (ms)</span>
              <input
                type="number"
                min={100}
                max={3600000}
                step={100}
                value={(config.permissionRequestTimeoutMs as number) ?? 120000}
                onChange={(e) => patch({ permissionRequestTimeoutMs: Math.max(100, Number(e.target.value)) })}
                disabled={!(config.permissionRequestTimeoutEnabled as boolean)}
                className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 text-center disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Update indicator (prod-only) */}
        <UpdateIndicator />

        {/* Coming Soon section */}
        <div className="border border-zinc-800 rounded-lg p-3 opacity-60 select-none">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              disabled
              className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-blue-500/30"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">
                  Auto-continue on assessment
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 border border-amber-800/40 rounded px-1.5 py-0.5">
                  Coming Soon
                </span>
              </div>
              <div className="text-xs text-zinc-600 mt-1">
                A lightweight LLM reviews the agent's last message and rates how
                likely it prematurely stopped. <span className="text-zinc-500">1</span> = finished,{" "}
                <span className="text-zinc-500">5</span> = unsure,{" "}
                <span className="text-zinc-500">10</span> = did not finish.
                Auto-continues when the assessed score is above a configurable
                threshold.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MDS Tool Skills */}
      <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
        <div className="text-sm text-zinc-200">MDS Tool Skills</div>
        <div className="text-xs text-zinc-500">
          Regenerate tool skill files from repo seeds. This will overwrite any existing tool skill files in the selected scopes.
        </div>
        <GenerateToolSeedsButton />
      </div>

      {/* DB compaction */}
      <CompactDatabaseSection />
    </div>
  );
}
