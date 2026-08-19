import { create } from "zustand";
import { wsClient } from "../../lib/ws";
import { useSessionViewStore } from "../../stores/sessionView";
import { useSessionStore } from "../../stores/sessions";
import {
  sortParts,
  textContentFromParts,
  maxSeqOf,
  consolidateTextParts,
  partsFromSnapshot,
} from "./parts-util";
import type { ChatState, RetryCountdownState } from "./types";
import type { RetryEntry } from "../../../../_shared/types";
import {
  getSessionMeta,
  getTurns,
  getEffectiveContextConfig,
  getSessionDraftInput,
  putSessionDraftInput,
} from "../../lib/api";
import type { SessionConfig } from "../../../../_shared/types";
import { chatDebug } from "./debug";

import {
  pendingPermToolNames,
  beginAwaitSessionState,
  resetHydrateState,
  incrementEpoch,
  loadSessionEpoch,
} from "./session-hydrate";

// ── Draft input persistence (debounced) ──────────────────────────────────────
let _draftSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
const DRAFT_SAVE_DEBOUNCE_MS = 400;
const NEW_CHAT_DRAFT_KEY = "VISUAL STUDIO HARNESS.newChatDraft";

function saveDraftDebounced(sessionId: string | null, content: string) {
  if (_draftSaveTimeoutId) clearTimeout(_draftSaveTimeoutId);
  _draftSaveTimeoutId = setTimeout(() => {
    _draftSaveTimeoutId = null;
    if (sessionId) {
      putSessionDraftInput(sessionId, content).catch((err) => {
        console.error("[draft] save failed:", err);
      });
    } else {
      // No session yet — persist to localStorage for new chat
      try {
        localStorage.setItem(NEW_CHAT_DRAFT_KEY, content);
      } catch { /* ignore */ }
    }
  }, DRAFT_SAVE_DEBOUNCE_MS);
}

function clearDraftSaveTimeout() {
  if (_draftSaveTimeoutId) {
    clearTimeout(_draftSaveTimeoutId);
    _draftSaveTimeoutId = null;
  }
}

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
  stopping: false,
  streamingContent: "",
  streamingParts: [],
  streamingOutputTps: null,
  // Live context token size (used / auto-compaction threshold) from per-step
  // provider returns. null = unknown (no step/usage seen yet).
  contextTokens: null,
  setContextTokens: (ctx) => set({ contextTokens: ctx }),
  lastSeq: 0,
  _partSeq: 0,
  _textSeq: 0,
  _reasonIdx: 0,
  _pendingDropdownAgent: undefined,
  /** Bumped on New Chat / clear so the composer resets to settings defaults. */
  composerResetEpoch: 0,
  _pendingContinueMessage: null,
  sessionId: null,
  streamingTurnId: null,
  sessionMeta: null,
  workspaceRoot: localStorage.getItem("VISUAL STUDIO HARNESS.workspaceRoot") || "",
  turns: {},
  inspectedTurnId: null,
  contextFirstTurnNumber: null,
  contextConfigMode: "fixed" as "sliding" | "fixed",
  contextConfigWindowSize: 10,
  setContextFirstTurnNumber: (tn) => set({ contextFirstTurnNumber: tn }),
  setContextConfigMode: (mode: "sliding" | "fixed") => set({ contextConfigMode: mode }),
  setContextConfigWindowSize: (n: number) => set({ contextConfigWindowSize: n }),
  contextConfigVersion: 0,
  bumpContextConfigVersion: () => set((s) => ({ contextConfigVersion: s.contextConfigVersion + 1 })),
  compacting: false,
  setCompacting: (v: boolean) => set({ compacting: v }),
  stagedChatInput: "",
  subagentConfigPrompt: null,
  setSubagentConfigPrompt: (prompt) => set({ subagentConfigPrompt: prompt }),
  slotBusyPrompt: null,
  setSlotBusyPrompt: (prompt) => set({ slotBusyPrompt: prompt }),
  agentChangePrompt: null,
  setAgentChangePrompt: (prompt) => set({ agentChangePrompt: prompt }),
  slotWaitState: null,
  retryCountdown: null,
  abortSlotWait: (requestId) => {
    const sid = get().sessionId || "";
    wsClient.send({ type: "slot_wait_abort", sessionId: sid, requestId });
  },
  setRetryCountdown: (state: RetryCountdownState) => set({ retryCountdown: state }),
  updateRetryCountdown: (remainingMs: number) => set((s) => ({ retryCountdown: s.retryCountdown ? { ...s.retryCountdown, remainingMs } : null })),
  clearRetryCountdown: () => set({ retryCountdown: null }),
  onRetryError: ({ entry, seq }) => {
    touchStreamTimeout();
    return set((state) => {
      if (seq <= state.lastSeq) return {};
      const parts = [...state.streamingParts];
      // Create a stable key for this error to group retries of the same upstream failure
      const errorKey = `${entry.errorCode ?? "none"}:${entry.category ?? "unknown"}:${entry.errorLabel}`;
      // Find existing error part for this specific upstream error
      const idx = parts.findIndex(
        (p) => p.type === "error" && (p as any).errorKey === errorKey,
      );
      const prev = idx >= 0 ? (parts[idx] as { type: "error"; retries?: RetryEntry[]; errorKey?: string } | undefined) : undefined;
      // Mark previous pending retries for THIS error as failed
      const retries = (prev?.retries ?? []).map((r) =>
        r.status === "pending" ? { ...r, status: "failed" as const } : r
      );
      retries.push(entry);
      const errPart = {
        type: "error" as const,
        message: entry.message,
        raw: entry.raw,
        isCustom: entry.isCustom,
        category: entry.category,
        timestamp: entry.errorTime,
        retries,
        providerName: state._pendingProviderName,
        errorKey,
        _seq: seq,
      };
      if (idx >= 0) parts[idx] = errPart as any;
      else parts.push(errPart as any);
      return {
        streamingParts: parts,
        lastSeq: Math.max(state.lastSeq, seq),
        _partSeq: Math.max(state._partSeq, seq),
        retryCountdown: {
          attempt: entry.attempt,
          maxAttempts: entry.maxAttempts,
          totalDelayMs: entry.delayMs,
          remainingMs: entry.delayMs,
          errorLabel: entry.errorLabel,
        },
      };
    });
  },
  streamingStartTime: null,
  setStreamingStartTime: (time) => set({ streamingStartTime: time }),

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
  stageChatInput: (content) => {
    const next =
      typeof content === "function"
        ? (content as (prev: string) => string)(get().stagedChatInput)
        : content;
    set({ stagedChatInput: next });
    const sid = get().sessionId;
    saveDraftDebounced(sid, next);
  },

  loadSession: async (id) => {
    const epoch = incrementEpoch();
    const requestId = epoch;
    useSessionViewStore.getState().setCurrentSession(id);
    beginAwaitSessionState(epoch, requestId);

    set({
      sessionId: id,
      messages: [],
      streaming: false,
      stopping: false,
      streamingContent: "",
      streamingParts: [],
      streamingOutputTps: null,
      streamingTurnId: null,
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
      streamingStartTime: null,
      stagedChatInput: "",
      retryCountdown: null,
    });

    wsClient.send({ type: "request_session_state", sessionId: id, requestId });

    try {
      const meta = await getSessionMeta(id);
      if (epoch !== loadSessionEpoch) return;
      if (meta) {
        const ws = meta.workspaceRoot || get().workspaceRoot;
        if (meta.workspaceRoot) {
          localStorage.setItem("VISUAL STUDIO HARNESS.workspaceRoot", meta.workspaceRoot);
        }
        set({ sessionMeta: meta, workspaceRoot: ws });
      }
    } catch {
    }

    // Load draft input for this session
    try {
      const { draft } = await getSessionDraftInput(id);
      if (epoch === loadSessionEpoch) {
        set({ stagedChatInput: draft ?? "" });
      }
    } catch { /* ignore */ }

    // Load context config (effective: session > project > global)
    try {
      const workspaceRootForCtx = get().workspaceRoot;
      const ctxCfg = await getEffectiveContextConfig(id, workspaceRootForCtx || undefined);
      set({
        contextFirstTurnNumber: ctxCfg.firstTurnNumber,
        contextConfigMode: ctxCfg.mode ?? "fixed",
        contextConfigWindowSize: ctxCfg.windowSize ?? 10,
      });
    } catch { /* ignore */ }
  },

  clearNewChatDraft: () => {
    try { localStorage.removeItem(NEW_CHAT_DRAFT_KEY); } catch { /* ignore */ }
    set({ stagedChatInput: "" });
  },

  startNewChat: () => {
    const { sessionId } = get();
    if (sessionId) {
      // There's an active session - clear it and start fresh
      set({
        sessionId: null,
        sessionMeta: null,
        messages: [],
        streaming: false,
        stopping: false,
        streamingContent: "",
        streamingParts: [],
        streamingOutputTps: null,
        streamingTurnId: null,
        lastSeq: 0,
        _partSeq: 0,
        _textSeq: 0,
        _reasonIdx: 0,
        streamingStartTime: null,
        retryCountdown: null,
      });
    }
    // New Chat always resets the composer to the settings defaults.
    set((s) => ({ composerResetEpoch: s.composerResetEpoch + 1 }));
    // Clear session store activeId so sidebar green indicator clears
    useSessionStore.getState().setActive(null);
    // Load new chat draft from localStorage
    try {
      const draft = localStorage.getItem(NEW_CHAT_DRAFT_KEY);
      if (draft) {
        set({ stagedChatInput: draft });
      }
    } catch { /* ignore */ }
  },

  sendMessage: (content, config: SessionConfig) => {
    const { sessionId, messages, workspaceRoot } = get();
    // We are starting a live, client-initiated turn. Any in-flight
    // "awaiting session state" rehydration buffer (from a prior load or
    // reconnect) must be cleared so this turn's token/done events are
    // applied directly and not stranded in the pending-delta buffer.
    resetHydrateState();
    const userMsg = { role: "user" as const, content, timestamp: new Date().toISOString() };
    const startTime = Date.now();
    set({
      messages: [...messages, userMsg],
      streaming: true,
      stopping: false,
      streamingContent: "",
      streamingParts: [],
      streamingOutputTps: null,
      streamingTurnId: null,
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
      _pendingAgentName: config.agentName || "Default (no system prompt)",
      _pendingModelName: config.modelName,
      _pendingProviderName: config.providerName,
      streamingStartTime: startTime,
      stagedChatInput: "",
    });
    // Clear persisted draft for this session (or new chat)
    if (sessionId) {
      clearDraftSaveTimeout();
      putSessionDraftInput(sessionId, "").catch((err) => console.error("[draft] clear failed:", err));
    } else {
      // No session yet — clear new chat draft from localStorage
      try { localStorage.removeItem(NEW_CHAT_DRAFT_KEY); } catch { /* ignore */ }
    }
    chatDebug("store", "sendMessage -> streaming=true", { sessionId, agentName: config.agentName });
    touchStreamTimeout();
    const { contextFirstTurnNumber: ctxTn } = get();
    const wsMsg = {
      type: "chat",
      sessionId: sessionId || "new",
      content,
      workspaceRoot: sessionId ? undefined : workspaceRoot || undefined,
      agentName: config.agentName || undefined,
      providerName: config.providerName,
      modelName: config.modelName,
      thinkingEffort: config.thinkingEffort,
      contextFirstTurnNumber: ctxTn,
    };
    wsClient.send(wsMsg);
  },

  clearMessages: () => {
    clearStreamTimeout();
    clearDraftSaveTimeout();
    useSessionViewStore.getState().setCurrentSession(null);
    resetHydrateState();
    // Clear new chat draft
    try { localStorage.removeItem(NEW_CHAT_DRAFT_KEY); } catch { /* ignore */ }
    set({
      messages: [],
      streaming: false,
      stopping: false,
      streamingContent: "",
      streamingParts: [],
      streamingOutputTps: null,
      streamingTurnId: null,
      lastSeq: 0,
      _partSeq: 0,
      _textSeq: 0,
      _reasonIdx: 0,
      sessionId: null,
      sessionMeta: null,
      turns: {},
      inspectedTurnId: null,
      streamingStartTime: null,
      retryCountdown: null,
    });
    // Leaving to the new-chat composer resets the composer to defaults too.
    set((s) => ({ composerResetEpoch: s.composerResetEpoch + 1 }));
  },

  stopStreaming: () => {
    clearStreamTimeout();
    const state = get();
    const { sessionId, stopping } = state;
    if (stopping) return; // already stopping
    if (sessionId) {
      wsClient.send({ type: "cancel", sessionId });
    }
    set({ stopping: true, streamingStartTime: null, retryCountdown: null });
  },

  appendToken: (token, seq, tps) => {
    touchStreamTimeout();
    return set((state) => {
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
      return {
        messages: msgs,
        streamingParts: parts,
        streamingContent: content,
        streamingOutputTps: typeof tps === "number" ? tps : state.streamingOutputTps,
        lastSeq: nextSeq,
        _partSeq: nextSeq,
      };
    });
  },

  clearOutputTps: () => set({ streamingOutputTps: null }),

  appendReasoning: (delta, seq, tps) => {
    touchStreamTimeout();
    return set((state) => {
      if (seq != null && seq <= state.lastSeq) return {};
      const nextSeq = seq ?? state.lastSeq + 1;
      const parts = [...state.streamingParts];
      const last = parts[parts.length - 1];
      const tpsPatch = typeof tps === "number" ? { liveTps: tps } : {};
      if (last && last.type === "reasoning") {
        parts[parts.length - 1] = { ...last, content: (last.content || "") + delta, ...tpsPatch };
        return { streamingParts: parts, lastSeq: nextSeq, _partSeq: nextSeq };
      }
      parts.push({ type: "reasoning", content: delta, _seq: nextSeq, ...tpsPatch } as any);
      return { streamingParts: parts, lastSeq: nextSeq, _partSeq: nextSeq, _reasonIdx: parts.length };
    });
  },

  endThinking: () => {
    return set((state) => {
      const parts = [...state.streamingParts];
      // Clear liveTps from the active (last) reasoning part — phase ended.
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.type === "reasoning" && (p as { liveTps?: number }).liveTps != null) {
          parts[i] = { ...p, liveTps: undefined };
          break;
        }
      }
      return { streamingParts: parts };
    });
  },

  doneStreaming: (modelName?, providerName?, durationMs?, turnId?, agentName?) => {
    clearStreamTimeout();
    return set((state) => {
      const hasContinue = state._pendingContinueMessage;
      const wasStopped = state.stopping;
      chatDebug("store", "doneStreaming", { turnId, hadContinue: !!hasContinue, nextStreaming: !!hasContinue, wasStopped });
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      // Turn ended — settle any pending retry entries in ALL error parts and KEEP them
      // (amber recovered log) so the collapsibles survive the committed message.
      const outcome = wasStopped ? ("aborted" as const) : ("succeeded" as const);
      const settledParts = state.streamingParts.map((p) => {
        if (p.type !== "error" || !p.retries || p.retries.length === 0) return p;
        return {
          ...p,
          retries: p.retries.map((r) => (r.status === "pending" ? { ...r, status: outcome } : r)),
        };
      });
      const parts = settledParts.length > 0 ? sortParts(settledParts) : undefined;
      const content = parts ? textContentFromParts(parts) : "";
      const effectiveAgentName = agentName || state._pendingAgentName || last?.agentName;
      const effectiveModelName = modelName || state._pendingModelName || last?.modelName;
      const effectiveProviderName = providerName || state._pendingProviderName || last?.providerName;
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: content || last.content, parts: parts || last.parts, modelName: effectiveModelName, providerName: effectiveProviderName, agentName: effectiveAgentName, durationMs, turnId, success: true as any };
      } else {
        msgs.push({ role: "assistant", content, timestamp: new Date().toISOString(), parts, modelName: effectiveModelName, providerName: effectiveProviderName, agentName: effectiveAgentName, durationMs, turnId, success: true as any });
      }
      if (wasStopped) {
        msgs.push({ role: "user", content: "<system> Stream stopped by user </system>", timestamp: new Date().toISOString() });
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
      return { messages: updatedMessages, streaming: !!hasContinue, stopping: false, streamingContent: "", streamingParts: [], streamingOutputTps: null, streamingTurnId: null, lastSeq: hasContinue ? 0 : state.lastSeq, _reasonIdx: 0, _pendingAgentName: nextAgentName, _pendingModelName: undefined, _pendingProviderName: undefined, _pendingDropdownAgent: undefined, _pendingContinueMessage: null, streamingStartTime: hasContinue ? Date.now() : null, retryCountdown: null };
    });
  },

  failStreaming: (error, meta) => {
    clearStreamTimeout();
    return set((state) => {
      const errText = (error || "Unknown error").trim() || "Unknown error";
      const raw = meta?.rawError?.trim();
      const isCustom = meta?.errorIsCustom === true && !!raw && raw !== errText;
      const category = meta?.category;
      const errLine = `[Error: ${errText}]`;
      const msgs = [...state.messages];
      let parts = state.streamingParts.length > 0 ? sortParts(state.streamingParts) : [];
      // Merge the backend retry log into the matching error part(s) by errorKey.
      // If backendRetries have errorKey info, match by that; otherwise fall back
      // to the first error part (legacy behavior).
      const backendRetries = (meta?.retries ?? []).map((r) =>
        r.status === "pending" ? { ...r, status: "failed" as const } : r
      );
      if (backendRetries.length > 0) {
        // Group backend retries by their errorKey (if present)
        const retriesByKey = new Map<string, RetryEntry[]>();
        for (const r of backendRetries) {
          const key = (r as any).errorKey ?? `${r.errorCode ?? "none"}:${r.category ?? "unknown"}:${r.errorLabel}`;
          const list = retriesByKey.get(key);
          if (list) list.push(r);
          else retriesByKey.set(key, [r]);
        }
        // Merge into existing error parts by errorKey
        for (const [key, retries] of retriesByKey) {
          const idx = parts.findIndex(
            (p) => p.type === "error" && (p as any).errorKey === key,
          );
          if (idx >= 0) {
            const existing = parts[idx] as { type: "error"; retries?: RetryEntry[] };
            parts[idx] = { ...existing, retries } as any;
          } else {
            // New error part for this key
            const firstRetry = retries[0];
            parts.push({
              type: "error" as const,
              message: firstRetry.message,
              raw: firstRetry.raw,
              isCustom: firstRetry.isCustom,
              category: firstRetry.category,
              timestamp: firstRetry.errorTime,
              retries,
              providerName: state._pendingProviderName,
              errorKey: key,
            } as any);
          }
        }
      } else if (parts.some((p) => p.type === "error")) {
        // No backend retries — settle any pending retries in existing error parts
        parts = parts.map((p) => {
          if (p.type !== "error" || !p.retries || p.retries.length === 0) return p;
          return {
            ...p,
            retries: p.retries.map((r) =>
              r.status === "pending" ? { ...r, status: "failed" as const } : r
            ),
          };
        });
      } else {
        // No error parts at all — create one for the final error
        const errorKey = `${0}:${category ?? "unknown"}:${errText.slice(0, 50)}`;
        parts = [
          ...parts,
          {
            type: "error" as const,
            message: errText,
            raw: isCustom ? raw : undefined,
            isCustom,
            category,
            timestamp: meta?.errorTime ?? new Date().toISOString(),
            providerName: meta?.providerName || state._pendingProviderName,
            errorKey,
          } as any,
        ];
      }
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
      return { messages: msgs, streaming: false, stopping: false, streamingContent: "", streamingParts: [], streamingOutputTps: null, streamingTurnId: null, lastSeq: 0, _reasonIdx: 0, _pendingContinueMessage: null, streamingStartTime: null, retryCountdown: null };
    });
  },

  onToolStart: ({ toolCallId, toolName, args, parentToolCallId, seq, stepIndex }) => {
    touchStreamTimeout();
    return set((state) => {
      if (seq != null && seq <= state.lastSeq) return {};
      if (state.streamingParts.some((p) => p.type === "tool" && p.toolCallId === toolCallId)) {
        return seq != null ? { lastSeq: Math.max(state.lastSeq, seq), _partSeq: Math.max(state._partSeq, seq) } : {};
      }
      const nextSeq = seq ?? state.lastSeq + 1;
      const parts = [...state.streamingParts, { type: "tool" as const, toolCallId, toolName, status: "running" as const, args, stepIndex, _seq: nextSeq, ...(parentToolCallId ? { parentToolCallId } : {}) }];
      return { streamingParts: parts, streamingContent: textContentFromParts(parts), lastSeq: nextSeq, _partSeq: nextSeq };
    });
  },

  onToolUpdate: ({ toolCallId, status, taskId }) => {
    touchStreamTimeout();
    return set((state) => ({
      streamingParts: state.streamingParts.map((p) => p.type === "tool" && p.toolCallId === toolCallId ? { ...p, status, ...(taskId ? { taskId } : {}) } : p),
    }));
  },

  onToolEnd: ({ toolCallId, status, result, error, turnId }) => {
    touchStreamTimeout();
    return set((state) => ({
      streamingParts: state.streamingParts.map((p) => p.type === "tool" && p.toolCallId === toolCallId ? { ...p, status, result, error } : p),
      ...(turnId != null ? { streamingTurnId: turnId } : {}),
    }));
  },

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
