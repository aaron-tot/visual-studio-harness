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
  const composerResetEpoch = useChatStore((s) => s.composerResetEpoch);

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
    // Sync the pill both ways: a session's saved agent applies, and an
    // agent-less session (or leaving a session) clears the pill instead of
    // leaving the previous session's agent shown.
    setSelectedAgent(metaAgent ? { id: metaAgent, name: metaAgent } : null);
  }, [sessionMeta?.agentName, setSelectedAgent]);

  // New Chat / leaving a session: reset the agent pill to the configured
  // "Defaults for new chats" agent (or none). Gated on the epoch bump so
  // config reloads never clobber an in-progress new-chat selection.
  // Leaving a session or mounting on the new-chat page: reset the agent
  // pill to the configured "Defaults for new chats" agent (or none).
  // Guarded by sessionId so config reloads and New Chat both apply, but
  // in-session dep changes are harmless (the guard fires but returns early).
  useEffect(() => {
    if (sessionId) return;
    const def = config.defaultAgent && config.agents?.[config.defaultAgent];
    setSelectedAgent(def ? { id: config.defaultAgent!, name: config.defaultAgent! } : null);
  }, [sessionId, config.defaultAgent, config.agents, setSelectedAgent]);

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
