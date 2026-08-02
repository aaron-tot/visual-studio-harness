import { useState, useEffect } from "react";
import { FileText, Plus, Undo2 } from "lucide-react";
import type { AgentSettings, AgentMdConfig } from "../../../../_shared/types";
import { useConfigStore } from "../../stores/config";
import { AgentRuntimeEditor } from "./AgentRuntimeEditor";
import { listAgents, putAgent, deleteAgent, getMdsScopePaths, getMdsAgentsPaths } from "../../lib/api";
import type { AgentFile, ScopeItem } from "../../lib/api";
import { useSessionStore } from "../../stores/sessions";

function defaultAgentSettings(): AgentSettings {
  return { skillMds: [] };
}

export function AgentsPanel() {
  const { config, update } = useConfigStore();
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [agentFiles, setAgentFiles] = useState<AgentFile[]>([]);
  const [showDefaultSysPicker, setShowDefaultSysPicker] = useState(false);
  const [defaultSysCustomPath, setDefaultSysCustomPath] = useState("");
  const [scopeItems, setScopeItems] = useState<ScopeItem[]>([]);
  const [sysPickerTab, setSysPickerTab] = useState<"discover" | "custom">("discover");
  const sessionId = useSessionStore((s) => s.activeId ?? s.sessions[0]?.id);

  // Fetch scope items for the default system prompt picker
  useEffect(() => {
    if (!sessionId) return;
    getMdsScopePaths({ sessionId, workspaceRoot: undefined })
      .then((result) => {
        const all: ScopeItem[] = [];
        for (const scope of Object.values(result.scopes)) {
          if (scope.available) all.push(...scope.items);
        }
        setScopeItems(all);
      })
      .catch(() => {});
  }, [sessionId]);

  const loadAgents = async () => {
    try {
      const files = await listAgents();
      setAgentFiles(files);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadAgents();
  }, []);

  const agentKeys = Object.keys(config.agents ?? {});
  const allKeys = [...new Set([...agentKeys, ...agentFiles.map((a) => a.key)])];

  useEffect(() => {
    if (!selectedKey && allKeys.length > 0) {
      setSelectedKey(allKeys[0]);
    }
  }, [allKeys.length, selectedKey]);

  const findSettings = (key: string): AgentSettings => {
    const file = agentFiles.find((a) => a.key === key);
    if (file) return { ...defaultAgentSettings(), ...file.settings };
    const fromConfig = config.agents?.[key];
    if (fromConfig) return { ...defaultAgentSettings(), ...fromConfig };
    return defaultAgentSettings();
  };

  const currentAgent = findSettings(selectedKey);

  const saveAgent = async (key: string, settings: AgentSettings) => {
    await putAgent(key, settings);
    void loadAgents();
  };

  const renameAgent = async (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const settings = findSettings(oldKey);
    await putAgent(newKey, settings);
    await deleteAgent(oldKey);
    setSelectedKey(newKey);
    void loadAgents();
  };

  const addAgent = async () => {
    const existing = agentFiles.map((a) => a.key);
    let name = "New Agent";
    let counter = 1;
    while (existing.includes(name) || config.agents?.[name]) {
      name = `New Agent ${counter}`;
      counter++;
    }
    // New agents inherit the config-level default system prompt base
    const settings: AgentSettings = { ...defaultAgentSettings() };
    if (config.systemPromptBase) {
      settings.systemPromptBase = { ...config.systemPromptBase };
    }
    await putAgent(name, settings);
    setSelectedKey(name);
    void loadAgents();
  };

  const removeAgent = async (key: string) => {
    await deleteAgent(key);
    if (selectedKey === key) setSelectedKey("");
    const current = useConfigStore.getState().config;
    if (current.agents?.[key]) {
      const agents = { ...current.agents };
      delete agents[key];
      useConfigStore.getState().setConfig({ ...current, agents });
    }
    void loadAgents();
  };

  const defaultSysPath = config.systemPromptBase?.path ?? null;

  return (
    <div className="space-y-4">
      {/* Default System Prompt Base — config-level */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-300">Default System Prompt Base</p>
              <p className="truncate text-[11px] text-zinc-500">
                {defaultSysPath ?? "V2 default (_SystemBase/systemPromptBase/prompt.md)"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {config.systemPromptBase && (
              <button
                onClick={() => {
                  update({ ...config, systemPromptBase: undefined });
                }}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                title="Restore V2 default"
              >
                <Undo2 className="h-3 w-3" />
                Restore default
              </button>
            )}
            <button
              onClick={() => setShowDefaultSysPicker(!showDefaultSysPicker)}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              {config.systemPromptBase ? "Change" : <><Plus className="h-3.5 w-3.5" /> Set</>}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          New agents inherit this default. Per-agent overrides ignore this.
        </p>

        {/* Default picker */}
        {showDefaultSysPicker && (
          <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 p-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => setSysPickerTab("discover")}
                className={`rounded px-2 py-1 text-xs ${
                  sysPickerTab === "discover"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Discover
              </button>
              <button
                onClick={() => setSysPickerTab("custom")}
                className={`rounded px-2 py-1 text-xs ${
                  sysPickerTab === "custom"
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Custom Path
              </button>
            </div>

            {sysPickerTab === "discover" && (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {scopeItems.length === 0 ? (
                  <p className="text-xs text-zinc-500">No scope items found</p>
                ) : (
                  scopeItems.map((i) => (
                    <button
                      key={i.promptPath}
                      onClick={() => {
                        update({ ...config, systemPromptBase: { mode: "existing", path: i.promptPath } });
                        setShowDefaultSysPicker(false);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      {i.relPath}
                    </button>
                  ))
                )}
              </div>
            )}

            {sysPickerTab === "custom" && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="/path/to/default-prompt.md"
                  value={defaultSysCustomPath}
                  onChange={(e) => setDefaultSysCustomPath(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                />
                <button
                  onClick={() => {
                    if (defaultSysCustomPath.trim()) {
                      update({ ...config, systemPromptBase: { mode: "existing", path: defaultSysCustomPath.trim() } });
                      setDefaultSysCustomPath("");
                      setShowDefaultSysPicker(false);
                    }
                  }}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                >
                  Set
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agent list */}
      <div className="flex flex-wrap items-center gap-2">
        {allKeys.map((key) => (
          <div key={key} className="flex items-center">
            <div
              onClick={() => setSelectedKey(key)}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm transition-colors cursor-pointer ${
                selectedKey === key
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              <span>{key}</span>
              <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeAgent(key);
                  }}
                  className="text-zinc-500 hover:text-red-400"
                  title="Delete"
                >
                  ×
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => void addAgent()}
          className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          + Add Agent
        </button>
      </div>

      {/* Agent config editor */}
      <AgentRuntimeEditor
        label={`${selectedKey} agent`}
        hint="Custom agent configuration."
        value={currentAgent}
        onChange={(v) => void saveAgent(selectedKey, v)}
        agentKey={selectedKey}
        onRename={(newKey) => void renameAgent(selectedKey, newKey)}
      />

      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] text-zinc-500 space-y-1.5">
        <p>
          <span className="font-medium text-zinc-400">System block</span> — rebuilt every
          model call from the agent's config: global system prompt base (systemPromptBase.md)
          + agent definition (agentMd) + skillMds + project AGENTS.md + runtime info.
        </p>
        <p>
          <span className="font-medium text-zinc-400">Subagents</span> — the task tool lists
          available agent configs dynamically; the parent picks one by agent_name and sends
          its prompt as a plain user message.
        </p>
        <p>
          <span className="font-medium text-zinc-400">Skills</span> — either pre-injected via
          skillMds config (inlined into system block) or loaded on-demand via the skill tool
          (single tool, resolves by name).
        </p>
      </div>
    </div>
  );
}
