import { create } from "zustand";
import { wsClient } from "../../lib/ws";
import { useSessionViewStore } from "../../stores/sessionView";
import {
  sortParts,
  textContentFromParts,
  maxSeqOf,
  consolidateTextParts,
  partsFromSnapshot,
} from "./parts-util";
import type { ChatState } from "./types";
import {
  getSession,
  getTurns,
} from "../../lib/api";
import type { SessionConfig } from "../../../_shared/types";
import { chatDebug } from "./debug";

import {
  pendingPermToolNames,
  beginAwaitSessionState,
  resetHydrateState,
  incrementEpoch,
  awaitingSessionState,
} from "./session-hydrate";

// ── Streaming timeout safety net ──────────────────────────────────────────
// Prevents "Thinking" from hanging forever if error/done events are lost
// (e.g. WebSocket disconnect, backend crash, race condition).
// Timer resets on every streaming event (token, reasoning, tool, etc).
// If no events arrive within STREAM_TIMEOUT_MS, force-stop with an error.
const STREAM_TIMEOUT_MS = 60_000;
let _streamTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Reset the streaming-done timeout. Call on every streaming event. */
export function touchStreamTimeout(): void {
  if (_streamTimeoutId) clearTimeout(_streamTimeoutId);
  if (!useChatStore.getState().streaming) { _streamTimeoutId = null; return; }
  _streamTimeoutId = setTimeout(() => {
    _streamTimeoutId = null;
    const store = useChatStore.getState();
    if (!store.streaming) return;
    chatDebug("stream-timeout", "force-stopping after 60s inactivity");
    store.failStreaming("Request timed out — no response from server. Please check the backend and try again.", { category: "network" });
  }, STREAM_TIMEOUT_MS);
}

/** Clear the streaming timeout when streaming ends. */
function clearStreamTimeout(): void {
  if (_streamTimeoutId) {
    clearTimeout(_streamTimeoutId);
    _streamTimeoutId = null;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  streamingContent: "",
  streamingParts: [],
  lastSeq: 0,
  _partSeq: 0,
  _textSeq: 0,
  _reasonIdx: 0,
  _pendingDropdownAgent: undefined,
  _pendingContinueMessage: null,
  sessionId: null,
  sessionMeta: null,
  workspaceRoot: localStorage.getItem("VISUAL STUDIO HARNESS.workspaceRoot") || "",
  turns: {},
  inspectedTurnId: null,
  stagedChatInput: "",
  subagentConfigPrompt: null,
  setSubagentConfigPrompt: (prompt) => set({ subagentConfigPrompt: prompt }),
  slotBusyPrompt: null,
  setSlotBusyPrompt: (prompt) => set({ slotBusyPrompt: prompt }),
  agentChangePrompt: null,
  setAgentChangePrompt: (prompt) => set({ agentChangePrompt: prompt }),
  slotWaitState: null,
  abortSlotWait: (requestId) => {
    const sid = get().sessionId || "";
    wsClient.send({ type: "slot_wait_abort", sessionId: sid, requestId });
  },

  setWorkspaceRoot: (path) => {
    localStorage.setItem("VISUAL STUDIO HARNESS.workspaceRoot", path);
    set({ workspaceRoot: path });
  },

  updateSessionMeta: (patch) =>
    set((state) => ({
      sessionMeta: state.sessionMeta ? { ...state.sessionMeta, ...patch } : null,
    })),

  loadTurns: async (sessionId) => {
    try {
      const { turns } = await getTurns(sessionId);
      set({ turns });
    } catch (err) {
      console.error("loadTurns failed:", err);
      set({ turns: {} });
    }
  },

  setInspectedTurnId: (turnId) => set({ inspectedTurnId: turnId }),
  stageChatInput: (content) => set({ stagedChatInput: content }),

  loadSession: async (id) => {
    const epoch = incrementEpoch();
    const requestId = epoch;
    useSessionViewStore.getState().setCurrentSession(id);
    beginAwaitSessionState(epoch, requestId);

    set({
      sessionId: id,
      messages: [],
      streaming: false,
      streamingContent: "",
      streamingParts: [],
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
    });

    wsClient.send({ type: "request_session_state", sessionId: id, requestId });

    try {
      const session = await getSession(id);
      if (epoch !== loadSessionEpoch) return;
      if (session) {
        const ws = session.meta.workspaceRoot || get().workspaceRoot;
        if (session.meta.workspaceRoot) {
          localStorage.setItem("VISUAL STUDIO HARNESS.workspaceRoot", session.meta.workspaceRoot);
        }
        set({ sessionMeta: session.meta, workspaceRoot: ws });
      }
      void get().loadTurns(id);
    } catch {
    }
  },

  sendMessage: (content, config: SessionConfig) => {
    const { sessionId, messages, workspaceRoot } = get();
    console.log("tmpDebug: store.sendMessage called", { sessionId, contentLen: content?.length, config });
    // We are starting a live, client-initiated turn. Any in-flight
    // "awaiting session state" rehydration buffer (from a prior load or
    // reconnect) must be cleared so this turn's token/done events are
    // applied directly and not stranded in the pending-delta buffer.
    resetHydrateState();
    const userMsg = { role: "user" as const, content, timestamp: new Date().toISOString() };
    set({
      messages: [...messages, userMsg],
      streaming: true,
      streamingContent: "",
      streamingParts: [],
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
      _pendingAgentName: config.agentName || "Default (no system prompt)",
    });
    console.log("STORE_SEND_MESSAGE streaming=true", { sessionId, contentLen: content?.length, awaitingSessionState });
    chatDebug("store", "sendMessage -> streaming=true", { sessionId, agentName: config.agentName });
    touchStreamTimeout();
    const wsMsg = {
      type: "chat",
      sessionId: sessionId || "new",
      content,
      workspaceRoot: sessionId ? undefined : workspaceRoot || undefined,
      agentName: config.agentName || undefined,
      providerName: config.providerName,
      modelName: config.modelName,
      thinkingEffort: config.thinkingEffort,
    };
    wsClient.send(wsMsg);
  },

  clearMessages: () => {
    clearStreamTimeout();
    useSessionViewStore.getState().setCurrentSession(null);
    resetHydrateState();
    set({
      messages: [],
      streaming: false,
      streamingContent: "",
      streamingParts: [],
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
      sessionId: null,
      sessionMeta: null,
      turns: {},
      inspectedTurnId: null,
    });
  },

  stopStreaming: () => {
    clearStreamTimeout();
    const state = get();
    const { sessionId, messages, streamingParts } = state;
    if (sessionId) {
      wsClient.send({ type: "cancel", sessionId });
    }
    const msgs = [...messages];
    if (streamingParts.length > 0) {
      const sorted = sortParts(streamingParts);
      const content = textContentFromParts(sorted);
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          content: last.content + content,
          parts: last.parts ? sortParts([...last.parts, ...sorted]) : sorted,
        };
      } else {
        msgs.push({ role: "assistant", content, parts: sorted, timestamp: new Date().toISOString() });
      }
    }
    msgs.push({ role: "user", content: "<system> Stream stopped by user </system>", timestamp: new Date().toISOString() });
    set({ messages: msgs, streaming: false, streamingContent: "", streamingParts: [], lastSeq: 0, _reasonIdx: 0 });
  },

  appendToken: (token, seq) =>
    set((state) => {
      if (seq != null && seq <= state.lastSeq) return {};
      const nextSeq = seq ?? state.lastSeq + 1;
      const parts = [...state.streamingParts];
      const last = parts[parts.length - 1];
      if (last && last.type === "text") {
        parts[parts.length - 1] = { ...last, content: (last.content || "") + token };
      } else {
        parts.push({ type: "text", content: token, _seq: nextSeq });
      }
      const content = textContentFromParts(parts);
      const msgs = [...state.messages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content };
      }
      return { messages: msgs, streamingParts: parts, streamingContent: content, lastSeq: nextSeq, _partSeq: nextSeq };
    }),

  appendReasoning: (delta, seq) =>
    set((state) => {
      if (seq != null && seq <= state.lastSeq) return {};
      const nextSeq = seq ?? state.lastSeq + 1;
      const parts = [...state.streamingParts];
      const last = parts[parts.length - 1];
      if (last && last.type === "reasoning") {
        parts[parts.length - 1] = { ...last, content: (last.content || "") + delta };
        return { streamingParts: parts, lastSeq: nextSeq, _partSeq: nextSeq };
      }
      parts.push({ type: "reasoning", content: delta, _seq: nextSeq } as any);
      return { streamingParts: parts, lastSeq: nextSeq, _partSeq: nextSeq, _reasonIdx: parts.length };
    }),

  doneStreaming: (modelName?, providerName?, durationMs?, turnId?, agentName?) => {
    clearStreamTimeout();
    return set((state) => {
      const hasContinue = state._pendingContinueMessage;
      chatDebug("store", "doneStreaming", { turnId, hadContinue: !!hasContinue, nextStreaming: !!hasContinue });
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      const parts = state.streamingParts.length > 0 ? sortParts(state.streamingParts) : undefined;
      const content = parts ? textContentFromParts(parts) : "";
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: content || last.content, parts: parts || last.parts, modelName: modelName || last.modelName, providerName: providerName || last.providerName, agentName: agentName || last.agentName, durationMs, turnId, success: true as any };
      } else {
        msgs.push({ role: "assistant", content, timestamp: new Date().toISOString(), parts, modelName, providerName, agentName, durationMs, turnId, success: true as any });
      }
      if (turnId != null) {
        const userIdx = msgs.length - 2;
        if (userIdx >= 0 && msgs[userIdx].role === "user") msgs[userIdx] = { ...msgs[userIdx], turnId };
      }
      if (state.sessionId) void get().loadTurns(state.sessionId);
      let updatedMessages = msgs;
      let nextAgentName: string | undefined;
      if (hasContinue) {
        updatedMessages = [...msgs, { role: "user" as const, content: hasContinue.content, timestamp: new Date().toISOString() }];
        nextAgentName = hasContinue.agentName;
      }
      return { messages: updatedMessages, streaming: !!hasContinue, streamingContent: "", streamingParts: [], lastSeq: hasContinue ? 0 : state.lastSeq, _reasonIdx: 0, _pendingAgentName: nextAgentName, _pendingDropdownAgent: undefined, _pendingContinueMessage: null };
    });
  },

  failStreaming: (error, meta) => {
    clearStreamTimeout();
    console.log("STORE_FAIL_STREAMING", { error, meta, streaming: get().streaming, messagesCount: get().messages.length });
    return set((state) => {
      const errText = (error || "Unknown error").trim() || "Unknown error";
      const raw = meta?.rawError?.trim();
      const isCustom = meta?.errorIsCustom === true && !!raw && raw !== errText;
      const category = meta?.category;
      const errorPart = { type: "error" as const, message: errText, raw: isCustom ? raw : undefined, isCustom, category };
      const errLine = `[Error: ${errText}]`;
      const msgs = [...state.messages];
      let parts = state.streamingParts.length > 0 ? sortParts(state.streamingParts) : [];
      parts = [...parts, errorPart as any];
      const streamed = textContentFromParts(parts);
      const content = streamed ? `${streamed}\n\n${errLine}` : errLine;
      const last = msgs[msgs.length - 1];
      const agentName = meta?.agentName || (state as any)._pendingAgentName || last?.agentName;
      const errDetail: Record<string, unknown> = { message: errText, raw: isCustom ? raw : undefined, isCustom };
      if (category) errDetail.category = category;
      const patch: Record<string, unknown> = { content, parts, modelName: meta?.modelName || last?.modelName, providerName: meta?.providerName || last?.providerName, agentName, durationMs: meta?.durationMs, turnId: meta?.turnId ?? last?.turnId, success: false, errorDetail: errDetail };
      if (meta?.status) patch.status = meta.status;
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, ...patch } as any;
      } else {
        msgs.push({ role: "assistant", content, parts, timestamp: new Date().toISOString(), ...patch } as any);
      }
      if (meta?.turnId != null) {
        const userIdx = msgs.length - 2;
        if (userIdx >= 0 && msgs[userIdx].role === "user") msgs[userIdx] = { ...msgs[userIdx], turnId: meta.turnId };
      }
      if (state.sessionId) void get().loadTurns(state.sessionId);
      return { messages: msgs, streaming: false, streamingContent: "", streamingParts: [], lastSeq: 0, _reasonIdx: 0, _pendingContinueMessage: null };
    });
  },

  onToolStart: ({ toolCallId, toolName, args, parentToolCallId, seq }) =>
    set((state) => {
      if (seq != null && seq <= state.lastSeq) return {};
      if (state.streamingParts.some((p) => p.type === "tool" && p.toolCallId === toolCallId)) {
        return seq != null ? { lastSeq: Math.max(state.lastSeq, seq), _partSeq: Math.max(state._partSeq, seq) } : {};
      }
      const nextSeq = seq ?? state.lastSeq + 1;
      const parts = [...state.streamingParts, { type: "tool" as const, toolCallId, toolName, status: "running" as const, args, _seq: nextSeq, ...(parentToolCallId ? { parentToolCallId } : {}) }];
      return { streamingParts: parts, streamingContent: textContentFromParts(parts), lastSeq: nextSeq, _partSeq: nextSeq };
    }),

  onToolUpdate: ({ toolCallId, status }) =>
    set((state) => ({
      streamingParts: state.streamingParts.map((p) => p.type === "tool" && p.toolCallId === toolCallId ? { ...p, status } : p),
    })),

  onToolEnd: ({ toolCallId, status, result, error }) =>
    set((state) => ({
      streamingParts: state.streamingParts.map((p) => p.type === "tool" && p.toolCallId === toolCallId ? { ...p, status, result, error } : p),
    })),

  respondPermission: (toolCallId, decision, sessionId, toolName) => {
    const sid = sessionId ?? get().sessionId;
    const resolvedName = pendingPermToolNames.get(toolCallId) || toolName;
    pendingPermToolNames.delete(toolCallId);
    const approved = decision === "approve" || decision === "approve_session" || decision === "approve_workspace" || decision === "approve_global";
    set((state) => ({
      streamingParts: state.streamingParts.map((p) => p.type === "tool" && p.toolCallId === toolCallId ? { ...p, status: approved ? ("running" as const) : ("error" as const), ...(approved ? {} : { error: p.error || "Permission denied" }) } : p),
      messages: state.messages.map((m) => {
        if (!m.parts?.length) return m;
        let changed = false;
        const parts = m.parts.map((p) => {
          if (p.type !== "tool" || p.toolCallId !== toolCallId) return p;
          if (p.status !== "awaiting_permission") return p;
          changed = true;
          return { ...p, status: approved ? ("running" as const) : ("error" as const), ...(approved ? {} : { error: p.error || "Permission denied" }) };
        });
        return changed ? { ...m, parts } : m;
      }),
    }));
    wsClient.send({ type: "permission_response", sessionId: sid || "", toolCallId, decision, toolName: resolvedName });
  },

  respondSubagentConfig: (payload) => {
    wsClient.send({ type: "subagent_config_response", sessionId: payload.sessionId || get().sessionId || "", requestId: payload.requestId, action: payload.action, providerName: payload.providerName, modelName: payload.modelName, temperature: payload.temperature, thinkingEffort: payload.thinkingEffort, maxSteps: payload.maxSteps });
    set({ subagentConfigPrompt: null });
    if (payload.action === "global") {
      void import("../../stores/config").then(({ useConfigStore }) => { void useConfigStore.getState().fetch(); });
    }
  },

  respondSlotBusy: (payload) => {
    wsClient.send({ type: "slot_busy_response", sessionId: payload.sessionId || get().sessionId || "", requestId: payload.requestId, action: payload.action, pollIntervalSec: payload.pollIntervalSec, waitTimeoutSec: payload.waitTimeoutSec });
    set({ slotBusyPrompt: null });
  },

  respondAgentChange: (payload) => {
    const sendPayload: Record<string, unknown> = { type: "agent_change_response", sessionId: payload.sessionId || get().sessionId || "", requestId: payload.requestId, action: payload.action, agentName: payload.agentName };
    if (payload.action === "switch_continue" && payload.continueMessage) {
      sendPayload.continueMessage = { content: payload.continueMessage.content, agentName: payload.continueMessage.agentName };
    }
    wsClient.send(sendPayload);
    set({ agentChangePrompt: null });
    if (payload.action === "switch_continue" && payload.continueMessage) {
      set({ _pendingContinueMessage: { content: payload.continueMessage.content, agentName: payload.continueMessage.agentName }, _pendingDropdownAgent: payload.continueMessage.agentName });
    } else if (payload.action === "switch" && payload.agentName) {
      set({ _pendingDropdownAgent: payload.agentName });
    }
  },
}));
