import { useState, useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chat";
import { useConfigStore } from "../../stores/config";
import { useTodoStore } from "../../features/todos/store/todoStore";
import { fetchSessionTodos } from "../../features/todos/api/todosApi";
import { useConnectionStatus } from "../../lib/useConnectionStatus";
import { NewChat } from "../chat/NewChat";
import { SessionConfigModal } from "../chat/SessionConfigModal";
import { listAgents, type AgentFile } from "../../lib/api";
import type { AgentOption } from "../chat/input/AgentSelector";
import { disconnectedBanner } from "../../styles/shared";

interface ChatAreaProps {
  onOpenSettings?: (tab?: "providers" | "agents" | "global" | "workspaces" | "model") => void;
}

export function ChatArea({ onOpenSettings }: ChatAreaProps) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentOption | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const { showBanner } = useConnectionStatus();
  const sessionId = useChatStore((s) => s.sessionId);
  const { config, fetch: fetchConfig } = useConfigStore();

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const files = await listAgents();
        setAgents(files.map((a) => ({ id: a.key, name: a.key, description: "" })));
      } catch { /* ignore */ }
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, []);

  const pendingDropdownAgent = useChatStore((s) => s._pendingDropdownAgent);
  const sessionMeta = useChatStore((s) => s.sessionMeta);

  useEffect(() => {
    if (pendingDropdownAgent) {
      setSelectedAgent({ id: pendingDropdownAgent, name: pendingDropdownAgent });
    }
  }, [pendingDropdownAgent, setSelectedAgent]);

  const lastSyncedAgent = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const metaAgent = sessionMeta?.agentName ?? null;
    if (metaAgent === lastSyncedAgent.current) return;
    lastSyncedAgent.current = metaAgent;
    if (metaAgent) {
      setSelectedAgent({ id: metaAgent, name: metaAgent });
    } else if (!sessionId) {
      if (config.defaultAgent && config.agents?.[config.defaultAgent]) {
        setSelectedAgent({ id: config.defaultAgent, name: config.defaultAgent });
      } else {
        setSelectedAgent(null);
      }
    }
  }, [sessionMeta?.agentName, sessionId, setSelectedAgent, config.defaultAgent, config.agents]);

  return (
    <main className="flex-1 flex flex-col h-full relative min-w-0">
      {showBanner && (
        <div className={disconnectedBanner}>
          Disconnected from server — reconnecting...
        </div>
      )}

      <NewChat
        agents={agents}
        selectedAgent={selectedAgent}
        setSelectedAgent={setSelectedAgent}
        setCfgOpen={setCfgOpen}
      />

      {cfgOpen && sessionId && (
        <SessionConfigModal
          sessionId={sessionId}
          onClose={() => setCfgOpen(false)}
        />
      )}
    </main>
  );
}
