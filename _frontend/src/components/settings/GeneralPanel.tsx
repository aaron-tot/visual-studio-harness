import { useMemo } from "react";
import { useConfigStore } from "../../stores/config";
import type { ConfigFile } from "../../../../_shared/types";
import { AgentSelector, type AgentOption } from "../chat/input/AgentSelector";
import { ModelDropdown } from "../chat/ModelDropdown";

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
        </div>

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
    </div>
  );
}
