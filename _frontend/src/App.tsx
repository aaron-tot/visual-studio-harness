import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Settings, Search, Copy, Check } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatArea } from "./components/layout/ChatArea";
import { InfoPanel } from "./components/layout/InfoPanel";
import { SettingsModal } from "./components/layout/SettingsModal";
import { SubagentConfigModal } from "./components/tools/SubagentConfigModal";
import { SlotBusyModal } from "./components/tools/SlotBusyModal";
import { useChatStore } from "./stores/chat";
import { useConfigStore } from "./stores/config";
import { wsClient } from "./lib/ws";


function SessionIdCopy({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doCopy = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      data-testid="session-id"
      className="ml-auto group inline-flex items-center gap-1 text-[11px] text-zinc-500 font-mono cursor-pointer"
      onClick={doCopy}
    >
      <span className="truncate max-w-[160px]">{id}</span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50">
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </span>
    </div>
  );
}

type SettingsTab = "providers" | "agents" | "global" | "mds";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const sessionId = useChatStore((s) => s.sessionId);
  const subagentConfigPrompt = useChatStore((s) => s.subagentConfigPrompt);
  const setSubagentConfigPrompt = useChatStore((s) => s.setSubagentConfigPrompt);
  const slotBusyPrompt = useChatStore((s) => s.slotBusyPrompt);
  const setSlotBusyPrompt = useChatStore((s) => s.setSlotBusyPrompt);
  const { fetch: fetchConfig } = useConfigStore();

  useEffect(() => {
    fetchConfig();
    wsClient.connect();
    return () => wsClient.disconnect();
  }, [fetchConfig]);

  const handleNewChat = () => {
    clearMessages();
  };

  const openSettings = (tab: SettingsTab = "providers") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const handleSettingsOpen = () => openSettings("providers");

  const [searchHover, setSearchHover] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const onSearchEnter = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchHover(true);
  }, []);

  const onSearchLeave = useCallback(() => {
    searchTimer.current = setTimeout(() => setSearchHover(false), 300);
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-1.5 px-3 py-1 shrink-0">
        <div className="rounded-xl border border-zinc-700/10 p-1">
          <button data-testid="settings" onClick={handleSettingsOpen} className="p-0.5 rounded-lg transition-all text-zinc-500" title="Settings">
            <Settings size={13} />
          </button>
        </div>
        <div className="rounded-xl border border-zinc-700/10 p-1">
          <button data-testid="new-chat" onClick={handleNewChat} className="p-0.5 rounded-lg transition-all text-zinc-500" title="New Chat">
            <Plus size={13} />
          </button>
        </div>
        <div
          className="rounded-xl border border-zinc-700/10 transition-all duration-200 overflow-hidden"
          style={{ width: searchHover ? 140 : 26 }}
          onMouseEnter={onSearchEnter}
          onMouseLeave={onSearchLeave}
        >
          <div className="flex items-center p-1">
            <Search size={13} className="shrink-0 text-zinc-500" />
            <div className="overflow-hidden transition-all duration-200" style={{ width: searchHover ? 120 : 0 }}>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full bg-transparent pl-1.5 pr-1 py-0.5 text-xs text-zinc-400 placeholder-zinc-500 focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>
        {sessionId && (
          <SessionIdCopy id={sessionId} />
        )}
      </div>

      <div className="flex flex-1 min-h-0 relative">
        <Sidebar search={search} />
        <ChatArea onOpenSettings={openSettings} />
        <InfoPanel />
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
        sessionId={sessionId || undefined}
        key={settingsOpen ? settingsTab : "closed"}
      />
      {subagentConfigPrompt && (
        <SubagentConfigModal
          prompt={subagentConfigPrompt}
          onClose={() => setSubagentConfigPrompt(null)}
        />
      )}
      {slotBusyPrompt && (
        <SlotBusyModal
          prompt={slotBusyPrompt}
          onClose={() => setSlotBusyPrompt(null)}
        />
      )}
    </div>
  );
}

export default App;
