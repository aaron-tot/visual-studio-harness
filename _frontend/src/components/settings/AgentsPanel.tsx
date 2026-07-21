import { useState, useEffect } from "react";
import type { AgentSettings } from "../../../../_shared/types";
import { useConfigStore } from "../../stores/config";
import { AgentRuntimeEditor } from "./AgentRuntimeEditor";
import { listAgents, putAgent, deleteAgent } from "../../lib/api";
import type { AgentFile } from "../../lib/api";

function defaultAgentSettings(): AgentSettings {
  return { skillMds: [] };
}

export function AgentsPanel() {
  const { config, update } = useConfigStore();
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [agentFiles, setAgentFiles] = useState<AgentFile[]>([]);

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
    await putAgent(name, defaultAgentSettings());
    setSelectedKey(name);
    void loadAgents();
  };

  const removeAgent = async (key: string) => {
    await deleteAgent(key);
    if (selectedKey === key) setSelectedKey("");
    // Remove from config store so allKeys doesn't keep stale entry
    const current = useConfigStore.getState().config;
    if (current.agents?.[key]) {
      const agents = { ...current.agents };
      delete agents[key];
      useConfigStore.getState().setConfig({ ...current, agents });
    }
    void loadAgents();
  };

  return (
    <div className="space-y-4">
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
          model call from the agent's config: global agents.md + agentMd + skillMds + project
          agents.md + runtime info.
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
