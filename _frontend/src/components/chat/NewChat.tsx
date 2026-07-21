import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, ChevronLeft, Send, Square, FolderOpen, ArrowUpToLine, Home, Copy, Check } from "lucide-react";

import { ErrorBoundary } from "../ErrorBoundary";
import { useConfigStore } from "../../stores/config";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessions";
import { useTodoStore } from "../../features/todos/store/todoStore";
import { fetchSessionTodos } from "../../features/todos/api/todosApi";
import { TodoItemRow } from "../../features/todos/components/TodoItem";
import { useWorkspacePicker } from "../../hooks/useWorkspacePicker";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useSnippetMenu } from "../../hooks/useSnippetMenu";
import { SnippetMenu } from "../chat/SnippetMenu";
import { wsClient } from "../../lib/ws";
import { getSession, listFs } from "../../lib/api";
import { AgentSelector, type AgentOption } from "../chat/input/AgentSelector";
import { ModelDropdown } from "../chat/ModelDropdown";
import { ThinkingDropdown } from "../chat/ThinkingDropdown";
import { MessageList } from "../chat/MessageList";
import { LastMessageButton } from "../chat/LastMessageButton";
import { ContextBar } from "../chat/ContextBar";
import { InjectIndicator } from "../InjectIndicator";
import { ContextIndicator } from "../chat/input/ContextIndicator";
import { SlotWaitingBanner } from "../tools/SlotWaitingBanner";
import { AgentChangeDock } from "../tools/AgentChangeDock";
import type { SessionConfig, ThinkingEffort } from "../../../../_shared/types";
import {
  triggerPill,
  dropdownPanel,
  glassCard,
  glassCardRim,
  glassCardShadow,
  glassCardShadowHover,
  glassCardShadowHalf,
  glassCardShadowHoverHalf,
  cardToolbar,
  chatTextarea,
  sendButton,
  stopButton,
  dotGrid,
  dotGridStyle,
} from "../../styles/shared";

function CopyButtonSimple({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className="relative group inline-flex items-center gap-1.5 text-[10px] text-zinc-600 font-mono cursor-pointer"
      onClick={doCopy}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); doCopy(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function WorkspaceSelect() {
  const { workspaceRoot, open, recent, browsing, fs, loading, fsPath, openPicker, close, apply, browse, goUp, setFsPath } = useWorkspacePicker();
  const ref = useRef<HTMLDivElement>(null);
  const [pathInput, setPathInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; path: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, close, open);
  const displayPath = workspaceRoot || "~/Desktop";

  const handlePathInput = useCallback((value: string) => {
    setPathInput(value);
    setShowSuggestions(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!value.trim()) { setSuggestions([]); return; }
      try {
        const res = await listFs(value);
        if (res?.entries) {
          setSuggestions(res.entries.filter((e: any) => e.isDir).map((e: any) => ({ name: e.name, path: e.path })));
        }
      } catch { setSuggestions([]); }
    }, 300);
  }, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    setPathInput("");
  }, [fsPath]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={openPicker} className={triggerPill}>{displayPath}</button>
      {open && !browsing && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 min-w-[280px] rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-600 font-medium">Recent</div>
          {recent.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">No recent workspaces</div>}
          {recent.map((w) => (
            <button key={w} type="button" onClick={() => apply(w)} className="w-full text-left px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200 transition-colors font-mono truncate">{w}</button>
          ))}
          <div className="border-t border-zinc-800 mt-1 pt-1">
            <button type="button" onClick={() => browse()} className="w-full text-left px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200 transition-colors flex items-center gap-2">
              <FolderOpen size={12} />
              Browse folders...
            </button>
          </div>
        </div>
      )}
      {open && browsing && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 min-w-[360px] rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 flex flex-col">
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800">
            {fs?.parent && (
              <button type="button" onClick={goUp} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800" title="Parent directory">
                <ArrowUpToLine size={14} />
              </button>
            )}
            <button type="button" onClick={() => browse()} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800" title="Home directory">
              <Home size={14} />
            </button>
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={pathInput || fsPath}
                onChange={(e) => handlePathInput(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pathInput.trim()) {
                    browse(pathInput.trim());
                    setShowSuggestions(false);
                  }
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
                placeholder="/path/to/folder"
                className="w-full bg-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-0.5 z-50 max-h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl">
                  {suggestions.map((s) => (
                    <button
                      key={s.path}
                      type="button"
                      onClick={() => { browse(s.path); setPathInput(""); setShowSuggestions(false); }}
                      className="w-full text-left px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 flex items-center gap-1.5"
                    >
                      <FolderOpen size={10} className="text-zinc-500 shrink-0" />
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto px-1">
            <div className="px-2 py-1 text-[10px] text-zinc-600 font-mono truncate">{fsPath || "..."}</div>
            {loading && <div className="px-3 py-2 text-xs text-zinc-600">Loading...</div>}
            {!loading && fs?.entries?.filter((e: any) => e.isDir).map((e: any) => (
              <div key={e.path} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-800/50 group">
                <button
                  type="button"
                  onClick={() => browse(e.path)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <FolderOpen size={12} className="text-zinc-600 shrink-0" />
                  <span className="truncate">{e.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => apply(e.path)}
                  className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-[10px] font-medium rounded bg-zinc-700 text-zinc-300 hover:bg-emerald-700 hover:text-white transition-all"
                >
                  Use
                </button>
              </div>
            ))}
            {!loading && fs?.path && (
              <div className="border-t border-zinc-800 mt-1 pt-1 px-2 pb-1">
                <button
                  type="button"
                  onClick={() => apply(fs.path)}
                  className="w-full text-center px-2 py-1 text-xs font-medium rounded bg-zinc-800 text-emerald-400 hover:bg-emerald-800/50 hover:text-emerald-300 transition-colors"
                >
                  Use this folder
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveTodo({ sessionId }: { sessionId: string | null }) {
  const activeId = useTodoStore((s) => s.activeSessionId);
  const id = sessionId ?? activeId;
  const session = useTodoStore((s) => (id ? s.bySession[id] : undefined));
  const setActiveSession = useTodoStore((s) => s.setActiveSession);
  const [expanded, setExpanded] = useState(false);
  const pendingTodoCalls = useRef(new Set<string>());
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (sessionId) setActiveSession(sessionId); }, [sessionId, setActiveSession]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchSessionTodos(id).then((items) => { if (!cancelled) useTodoStore.getState().hydrate(id, items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const onToolStart = (data: any) => {
      if (data.toolName === "todowrite") {
        pendingTodoCalls.current.add(data.toolCallId);
      }
    };
    const onToolEnd = (data: any) => {
      if (pendingTodoCalls.current.has(data.toolCallId)) {
        pendingTodoCalls.current.delete(data.toolCallId);
        fetchSessionTodos(id).then((items) => useTodoStore.getState().hydrate(id, items)).catch(() => {});
      }
    };
    wsClient.on("tool_start", onToolStart);
    wsClient.on("tool_end", onToolEnd);
    return () => {
      wsClient.off("tool_start", onToolStart);
      wsClient.off("tool_end", onToolEnd);
    };
  }, [id]);

  const todos = session?.items ?? [];
  const active = useMemo(
    () => todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending"),
    [todos],
  );

  const activeIndex = useMemo(
    () => (active ? todos.indexOf(active) : -1),
    [active, todos],
  );

  const completedCount = useMemo(
    () => todos.filter((t) => t.status === "completed").length,
    [todos],
  );

  useEffect(() => {
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);

  if (todos.length === 0) return null;

  return (
    <div
      className="relative"
      ref={containerRef}
      onMouseEnter={() => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = undefined; } }}
      onMouseLeave={() => { if (expanded) { closeTimer.current = setTimeout(() => setExpanded(false), 200); } }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-4 py-1.5 border-b border-zinc-800/50 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors text-left"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        <span className="text-xs text-zinc-300 truncate flex-1">
          {active ? active.content : "No active todo"}
        </span>
        <span className="text-[10px] text-zinc-500 shrink-0">
          {active && activeIndex >= 0 ? `${activeIndex + 1}/${todos.length}` : `${todos.length}`}
          {' · '}{completedCount}/{todos.length} done
        </span>
        <span className="text-[10px] text-zinc-500 shrink-0 ml-1">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && todos.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-zinc-800/50 bg-zinc-900 px-4 py-2 space-y-1 max-h-60 overflow-y-auto shadow-xl">
          {todos.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600 w-4 text-right shrink-0">{i + 1}.</span>
              <TodoItemRow item={item} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewChat({ agents, selectedAgent, setSelectedAgent, setCfgOpen }: {
  agents: AgentOption[];
  selectedAgent: AgentOption | null;
  setSelectedAgent: (a: AgentOption | null) => void;
  setCfgOpen: (v: boolean) => void;
}) {
  const config = useConfigStore((s) => s.config);
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const sessionId = useChatStore((s) => s.sessionId);
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const { sendMessage, stopStreaming } = useChatStore();

  const isEmptyComposer = messages.length === 0 && !streaming && !sessionId;
  const inSession = !isEmptyComposer;

  const [submitted, setSubmitted] = useState(false);
  const [input, setInput] = useState("");
  const [hovered, setHovered] = useState(false);
  const [cardHeight, setCardHeight] = useState(240);
  const [modelError, setModelError] = useState(false);

  // Single source of truth for agent/model/thinking config
  const initialAgent = config.defaultAgent && config.agents?.[config.defaultAgent];
  const [currentConfig, setCurrentConfig] = useState<SessionConfig>({
    agentName: initialAgent ? config.defaultAgent! : null,
    providerName: initialAgent?.providerName || config.defaultProvider || "",
    modelName: initialAgent?.modelName || config.defaultModel || "",
    thinkingEffort: initialAgent?.thinking?.effort || "off",
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const snippets = config.snippets ?? [];

  const snippetMenu = useSnippetMenu({
    onInsert: (idx: number) => {
      const snippet = snippets[idx];
      if (!snippet) return;
      const el = inputRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newVal = input.slice(0, start) + snippet.content + input.slice(end);
      setInput(newVal);
      requestAnimationFrame(() => {
        const newPos = start + snippet.content.length;
        el.setSelectionRange(newPos, newPos);
        el.focus();
      });
    },
    snippetCount: snippets.length,
  });

  const isSubagent = sessionMeta?.kind === "subagent";
  const parentId = sessionMeta?.parentId;

  const [parentTitle, setParentTitle] = useState<string | null>(null);

  useEffect(() => { if (isEmptyComposer) setSubmitted(false); }, [isEmptyComposer]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<{ content: string; position: "start" | "end" }>) => {
      const { content, position } = e.detail;
      if (position === "start") {
        setInput((prev) => (prev ? content + "\n" + prev : content));
      } else {
        setInput((prev) => (prev ? prev + "\n" + content : content));
      }
    };
    document.addEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
    return () => document.removeEventListener("VISUAL STUDIO HARNESS:stage-input", handler as EventListener);
  }, []);
  useEffect(() => { if (cardRef.current) setCardHeight(cardRef.current.offsetHeight); }, [isSubagent]);

  useEffect(() => {
    if (!isSubagent || !parentId) { setParentTitle(null); return; }
    let cancelled = false;
    getSession(parentId).then((s) => {
      if (!cancelled) setParentTitle(s.meta.title || parentId);
    }).catch(() => {
      if (!cancelled) setParentTitle(parentId);
    });
    return () => { cancelled = true; };
  }, [isSubagent, parentId]);

  useEffect(() => {
    if (sessionMeta) {
      setCurrentConfig({
        agentName: sessionMeta.agentName || null,
        providerName: sessionMeta.providerName || "",
        modelName: sessionMeta.modelName || "",
        thinkingEffort: sessionMeta.thinkingEffort || "off",
      });
    }
  }, [sessionMeta?.id]);

  // Update config defaults when they change in config store
  useEffect(() => {
    setCurrentConfig(prev => {
      const agent = config.defaultAgent && config.agents?.[config.defaultAgent];
      if (!prev.agentName && config.defaultAgent && agent) {
        return {
          agentName: config.defaultAgent,
          providerName: agent.providerName || config.defaultProvider || "",
          modelName: agent.modelName || config.defaultModel || "",
          thinkingEffort: agent.thinking?.effort || "off",
        };
      }
      return {
        ...prev,
        providerName: prev.providerName || config.defaultProvider || "",
        modelName: prev.modelName || config.defaultModel || "",
      };
    });
  }, [config.defaultProvider, config.defaultModel, config.defaultAgent, config.agents]);

  const contextTokens = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.contextTokens) return msg.contextTokens;
    }
    return undefined;
  }, [messages]);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;
    if (!currentConfig.providerName || !currentConfig.modelName) {
      setModelError(true);
      return;
    }
    console.log("Message Submitted: ",currentConfig)
    sendMessage(input, currentConfig);
    setInput("");
    inputRef.current?.focus();
    if (!submitted) setSubmitted(true);
  }, [input, sendMessage, submitted, currentConfig]);

  const handleContinue = useCallback(() => {
    sendMessage("continue", currentConfig);
    inputRef.current?.focus();
  }, [sendMessage, currentConfig]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleAgentSelect = useCallback((agent: AgentOption | null) => {
    setModelError(false);
    setSelectedAgent(agent);
    const agentCfg = agent?.id ? config.agents?.[agent.id] : undefined;
    setCurrentConfig({
      agentName: agent?.id || null,
      providerName: agentCfg?.providerName || config.defaultProvider || "",
      modelName: agentCfg?.modelName || config.defaultModel || "",
      thinkingEffort: agentCfg?.thinking?.effort || "off",
    });
    // If session exists, send session_update with new values
    if (sessionId) {
      wsClient.send({
        type: "session_update",
        sessionId,
        agentName: agent?.id ?? null,
        providerName: agentCfg?.providerName || config.defaultProvider || "",
        modelName: agentCfg?.modelName || config.defaultModel || "",
        thinkingEffort: agentCfg?.thinking?.effort || "off",
      });
      useChatStore.getState().updateSessionMeta({
        agentName: agent?.id || undefined,
        providerName: agentCfg?.providerName || config.defaultProvider || "",
        modelName: agentCfg?.modelName || config.defaultModel || "",
        thinkingEffort: agentCfg?.thinking?.effort || "off",
      });
    }
  }, [config, sessionId, setSelectedAgent]);

  const handleModelSelect = useCallback((provider: string, model: string) => {
    setModelError(false);
    setCurrentConfig(prev => ({ ...prev, providerName: provider, modelName: model }));
    if (sessionId) {
      wsClient.send({ type: "session_update", sessionId, providerName: provider, modelName: model });
      useChatStore.getState().updateSessionMeta({ providerName: provider, modelName: model });
    }
  }, [sessionId]);

  const handleThinkingChange = useCallback((effort: string) => {
    setCurrentConfig(prev => ({ ...prev, thinkingEffort: effort as ThinkingEffort }));
    if (sessionId) {
      wsClient.send({ type: "session_update", sessionId, thinkingEffort: effort as ThinkingEffort });
      useChatStore.getState().updateSessionMeta({ thinkingEffort: effort as ThinkingEffort });
    }
  }, [sessionId]);

  const controlsRow = (
    <div className={cardToolbar}>
      <AgentSelector agents={agents} selectedAgent={selectedAgent} triggerClassName={triggerPill}
        onSelect={handleAgentSelect}
      />
      <div className="relative">
        {modelError && (
          <div className="absolute -top-5 left-0 text-[10px] text-red-400 whitespace-nowrap">
            Select a provider &amp; model
          </div>
        )}
        <div className={modelError ? "ring-1 ring-red-500/50 rounded-full" : ""}>
          <ModelDropdown
            triggerClassName={triggerPill}
            providerName={currentConfig.providerName}
            modelName={currentConfig.modelName}
            onSelect={handleModelSelect}
          />
        </div>
      </div>
      <ThinkingDropdown
        value={currentConfig.thinkingEffort}
        onChange={handleThinkingChange}
      />
      <button type="button" onClick={() => setCfgOpen(true)} className={triggerPill}>cfg</button>
    </div>
  );

  

  const inputRow = (
      <div className="flex items-end gap-2">
      <div className="flex-1 relative">
        <InjectIndicator />
        <textarea data-testid="message-input" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..." rows={1} className={chatTextarea} />
      </div>
      {streaming ? (
        <button data-testid="stop" type="button" onClick={stopStreaming} className={stopButton}><Square size={14} fill="currentColor" /></button>
      ) : inSession && !input.trim() ? (
        <button data-testid="continue" type="button" onClick={handleContinue}
          className="shrink-0 mb-[7px] p-2 rounded-xl bg-transparent hover:bg-white/10 text-emerald-500 hover:text-emerald-300 transition-all duration-200 hover:scale-105 active:scale-95"
        ><Send size={14} /></button>
      ) : (
        <button data-testid="send" type="button" disabled={!input.trim()} onClick={handleSubmit} className={sendButton}><Send size={14} /></button>
      )}
    </div>
  );

  const halfCard = cardHeight / 2;
  const centeredCardTop = `calc(50% - ${halfCard}px)`;

  return (
    <ErrorBoundary>
    <SnippetMenu
      open={snippetMenu.open}
      selectedIdx={snippetMenu.selectedIdx}
      menuPos={snippetMenu.menuPos}
      snippets={snippets}
    />
    <div className="flex-1 h-full relative">
      <div className="fixed inset-0 pointer-events-none">
        <div className={dotGrid} style={dotGridStyle} />
      </div>

      {(submitted || inSession) && (
        <div className="h-full flex flex-col relative z-40 overflow-auto" style={{ transition: "opacity 500ms ease-in-out", opacity: submitted || inSession ? 1 : 0, paddingTop: "52px", paddingBottom: `calc(${cardHeight}px + 16px)` }}>
          {isSubagent && parentId && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-zinc-800/50 bg-zinc-900/30 text-xs text-zinc-400 shrink-0">
              <button
                type="button"
                onClick={() => useSessionStore.getState().setActive(parentId)}
                className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ChevronLeft size={12} />
                <span className="truncate max-w-[200px]">{parentTitle || parentId}</span>
              </button>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-200 truncate">{sessionMeta?.title || "Subagent"}</span>
            </div>
          )}
          <ActiveTodo sessionId={sessionId} />
          <SlotWaitingBanner />
          <div className="relative flex-1 flex flex-col min-h-0 msg-scroll-parent" id="msg-scroll-container">
            <MessageList />
            <LastMessageButton key={sessionId ?? "none"} />
          </div>
          <AgentChangeDock />
        </div>
      )}

      <ContextBar />

      {isEmptyComposer && !isSubagent && (
        <div className="absolute left-0 right-0 flex flex-col items-center z-50 pointer-events-none" style={{ top: `calc(25% - ${halfCard / 2}px - 2rem)` }}>
          <div className="text-center select-none space-y-6">
            <img src="/chat-icon.png" alt="Visual Studio Harness" className="w-[83px] h-[83px] mx-auto opacity-40 grayscale" />
            <div className="relative">
              <h1 className="text-[13px] font-semibold uppercase tracking-[0.35em] text-transparent bg-clip-text bg-gradient-to-b from-zinc-200/90 to-zinc-400/50">Visual Studio Harness</h1>
            </div>
          </div>
        </div>
      )}

      <div ref={cardRef} id="chat-input-card" className="z-50" style={{
        position: "absolute", left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: submitted || inSession ? "56rem" : "42rem",
        transition: "all 700ms ease-in-out",
        top: submitted || inSession ? "auto" : centeredCardTop,
        bottom: submitted || inSession ? "16px" : "auto",
      }}>
          <div className={glassCard} style={{ boxShadow: isEmptyComposer
            ? (hovered ? glassCardShadowHover : glassCardShadow)
            : (hovered ? glassCardShadowHoverHalf : glassCardShadowHalf) }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <div className={glassCardRim} />
            {!isSubagent && controlsRow}
            {!isSubagent && contextTokens && contextTokens.max > 0 && <ContextIndicator used={contextTokens.used} max={contextTokens.max} />}
            <div className="px-4 py-3">
              {isSubagent ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30 text-xs text-zinc-500">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                  Subagent session (read-only)
                </div>
              ) : (
                inputRow
              )}
            </div>
          </div>
      </div>

      <style>{`
        .msg-scroll-parent > div::-webkit-scrollbar { width: 4px; }
        .msg-scroll-parent > div::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(255,255,255,0.06); }
        .msg-scroll-parent > div::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {!isSubagent && (
        <div className="text-center" style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          transition: "top 700ms ease-in-out",
          top: submitted || inSession ? "-40px" : `calc(50% + ${halfCard + 16}px)`,
        }}>
          {inSession ? (
            <>
              <CopyButtonSimple text={workspaceRoot} />
              {config.showSessionName && sessionMeta?.title ? (
                <div
                  data-testid="session-name-header"
                  className="mt-1 text-[11px] text-zinc-400 font-medium truncate max-w-[80vw] px-2"
                  title={sessionMeta.title}
                >
                  {sessionMeta.title}
                </div>
              ) : null}
            </>
          ) : (
            <WorkspaceSelect />
          )}
        </div>
      )}

      {isEmptyComposer && !isSubagent && (
        <div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none z-50">
          <p className="text-[11px] text-zinc-700">Source-Available License © 2026 Aaron Tot</p>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
