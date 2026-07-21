import { wsClient } from "../../lib/ws";
import { useChatStore } from "./store";
import { useSessionViewStore } from "../../stores/sessionView";
import { chatDebug } from "./debug";
import {
  pendingPermToolNames,
  awaitingSessionState,
  pendingSessionStateRequestId,
  bufferDelta,
  endAwaitSessionState,
  replayPendingDeltas,
  beginReconnectSession,
  resetHydrateState,
  pendingDeltas,
} from "./session-hydrate";
import { consolidateTextParts, textContentFromParts, maxSeqOf, partsFromSnapshot } from "./parts-util";

wsClient.on("token", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) {
    chatDebug("token", "ignored: session mismatch", { eventSession: data.sessionId, current: currentId });
    return;
  }
  if (awaitingSessionState) {
    chatDebug("token", "buffered (awaiting session state)", { seq: data.seq });
    bufferDelta({ kind: "token", sessionId: data.sessionId, content: data.content, seq: data.seq });
    return;
  }
  useChatStore.getState().appendToken(data.content, data.seq);
});

wsClient.on("reasoning", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) {
    chatDebug("reasoning", "ignored: session mismatch", { eventSession: data.sessionId, current: currentId });
    return;
  }
  if (awaitingSessionState) {
    chatDebug("reasoning", "buffered (awaiting session state)", { seq: data.seq });
    bufferDelta({ kind: "reasoning", sessionId: data.sessionId, content: data.content, seq: data.seq });
    return;
  }
  useChatStore.getState().appendReasoning(data.content, data.seq);
});

wsClient.on("done", (data: any) => {
  const store = useChatStore.getState();

  // Accept done events that match the current session, OR "new" session
  // when no session is established yet (pre-bind turn).
  const sessionOk =
    data.sessionId === store.sessionId ||
    (!store.sessionId && data.sessionId === "new");
  if (!sessionOk) {
    chatDebug("done", "ignored: session mismatch", { eventSession: data.sessionId, storeSession: store.sessionId });
    return;
  }
  if (awaitingSessionState) {
    // `done` is the authoritative end-of-turn signal. If it arrives while we
    // are still awaiting session state, flush any buffered error first, then
    // finalize. Clearing the buffer without applying a buffered error would
    // leave a silent hang or a success with no error UI.
    chatDebug("done", "arrived while awaiting session state -> finalize turn", { turnId: data.turnId });
    const bufferedErr = pendingDeltas.find((e) => e.kind === "error" && e.sessionId === (data.sessionId || store.sessionId));
    resetHydrateState();
    if (bufferedErr && bufferedErr.kind === "error") {
      useChatStore.getState().failStreaming(bufferedErr.error || "Unknown error", {
        modelName: bufferedErr.modelName,
        providerName: bufferedErr.providerName,
        durationMs: bufferedErr.durationMs,
        turnId: bufferedErr.turnId,
        agentName: bufferedErr.agentName,
        rawError: bufferedErr.rawError,
        errorIsCustom: bufferedErr.errorIsCustom,
        category: bufferedErr.category,
      });
      return;
    }
    if (useChatStore.getState().streaming) {
      useChatStore.getState().doneStreaming(data.modelName, data.providerName, data.durationMs, data.turnId, data.agentName);
    }
    return;
  }
  if (!store.streaming) {
    chatDebug("done", "ignored: store.streaming is false (no active turn)", { turnId: data.turnId });
    return;
  }
  chatDebug("done", "applied", { turnId: data.turnId });
  store.doneStreaming(data.modelName, data.providerName, data.durationMs, data.turnId, data.agentName);
});

wsClient.on("error", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  const store = useChatStore.getState();
  const errSid = data.sessionId as string | undefined;
  console.log("WS_ERROR_RECEIVED", { errSid, currentId, storeSessionId: store.sessionId, error: data?.error, category: data?.category, awaitingSessionState, streaming: store.streaming });
  if (errSid && errSid !== "new") {
    if (currentId && errSid !== currentId) {
      console.log("WS_ERROR_SESSION_MISMATCH", { reason: "currentId mismatch", currentId, errSid });
      return;
    }
    if (!currentId && store.sessionId && errSid !== store.sessionId) {
      console.log("WS_ERROR_SESSION_MISMATCH", { reason: "store.sessionId mismatch", storeSessionId: store.sessionId, errSid });
      return;
    }
  }
  if (awaitingSessionState) {
    console.log("WS_ERROR_BUFFERED", { error: data?.error, turnId: data.turnId });
    chatDebug("error", "buffered (awaiting session state)", { error: data?.error, turnId: data.turnId });
    bufferDelta({ kind: "error", sessionId: errSid || store.sessionId || "new", error: data?.error || "Unknown error", rawError: data?.rawError, errorIsCustom: data?.errorIsCustom, modelName: data.modelName, providerName: data.providerName, durationMs: data.durationMs, turnId: data.turnId, agentName: data.agentName, status: data.status });
    return;
  }
  chatDebug("error", "applied" + (!store.streaming ? " (streaming was false)" : ""), { error: data?.error, turnId: data.turnId, category: data?.category });
  console.log("WS_ERROR_APPLYING", { error: data?.error, category: data?.category, streaming: store.streaming });
  console.error("chat error", data?.error, data?.rawError);
  store.failStreaming(data?.error || "Unknown error", { modelName: data.modelName, providerName: data.providerName, durationMs: data.durationMs, turnId: data.turnId, agentName: data.agentName, rawError: data?.rawError, errorIsCustom: data?.errorIsCustom, status: data.status, category: data?.category });
});

wsClient.on("tool_start", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) return;
  if (awaitingSessionState) {
    bufferDelta({ kind: "tool_start", sessionId: data.sessionId, toolCallId: data.toolCallId, toolName: data.toolName, args: data.args, parentToolCallId: data.parentToolCallId, seq: data.seq });
    return;
  }
  useChatStore.getState().onToolStart({ toolCallId: data.toolCallId, toolName: data.toolName, args: data.args, parentToolCallId: data.parentToolCallId, seq: data.seq });
});

wsClient.on("tool_update", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) return;
  if (awaitingSessionState) {
    bufferDelta({ kind: "tool_update", sessionId: data.sessionId, toolCallId: data.toolCallId, status: data.status, partial: data.partial, seq: data.seq });
    return;
  }
  useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: data.status, partial: data.partial, seq: data.seq });
});

wsClient.on("tool_end", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) return;
  if (awaitingSessionState) {
    bufferDelta({ kind: "tool_end", sessionId: data.sessionId, toolCallId: data.toolCallId, status: data.status, result: data.result, error: data.error, seq: data.seq });
    return;
  }
  useChatStore.getState().onToolEnd({ toolCallId: data.toolCallId, status: data.status, result: data.result, error: data.error, seq: data.seq });
});

wsClient.on("permission_request", (data: any) => {
  if (awaitingSessionState) return;
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  if (data.toolCallId && data.toolName) {
    pendingPermToolNames.set(data.toolCallId, data.toolName);
  }
  const parts = useChatStore.getState().streamingParts;
  if (!parts.some((p) => p.type === "tool" && p.toolCallId === data.toolCallId)) {
    useChatStore.getState().onToolStart({ toolCallId: data.toolCallId, toolName: data.toolName, args: data.args, seq: data.seq });
  } else if (data.args != null) {
    useChatStore.setState((state: any) => ({
      streamingParts: state.streamingParts.map((p: any) =>
        p.type === "tool" && p.toolCallId === data.toolCallId
          ? { ...p, args: typeof p.args === "object" && p.args && typeof data.args === "object" ? { ...(p.args as object), ...(data.args as object) } : data.args ?? p.args, status: "awaiting_permission" as const }
          : p
      ),
    }));
  }
  useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: "awaiting_permission" });
});

wsClient.on("subagent_config_request", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  if (data.toolCallId) useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: "awaiting_config" });
  useChatStore.getState().setSubagentConfigPrompt({ requestId: data.requestId, sessionId: data.sessionId || useChatStore.getState().sessionId || "", toolCallId: data.toolCallId, reason: data.reason || "Configure subagent model", suggestedProvider: data.suggestedProvider, suggestedModel: data.suggestedModel });
});

wsClient.on("slot_busy_request", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  if (data.toolCallId) useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: "awaiting_config" });
  useChatStore.getState().setSlotBusyPrompt({ requestId: data.requestId, sessionId: data.sessionId || useChatStore.getState().sessionId || "", toolCallId: data.toolCallId, detail: data.detail || "no free slots", free: typeof data.free === "number" ? data.free : 0, total: typeof data.total === "number" ? data.total : 0, modelAlias: data.modelAlias, baseUrl: data.baseUrl || "", defaultPollIntervalSec: data.defaultPollIntervalSec ?? 5, defaultWaitTimeoutSec: data.defaultWaitTimeoutSec ?? 300 });
});

wsClient.on("agent_change_request", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  if (data.toolCallId) useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: "awaiting_agent_change" });
  useChatStore.getState().setAgentChangePrompt({ requestId: data.requestId, sessionId: data.sessionId || useChatStore.getState().sessionId || "", toolCallId: data.toolCallId, suggestedAgent: data.suggestedAgent || "", reason: data.reason || "", agents: data.agents || [] });
});

wsClient.on("slot_wait_started", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  if (data.toolCallId) useChatStore.getState().onToolUpdate({ toolCallId: data.toolCallId, status: "awaiting_config" });
  useChatStore.setState({ slotWaitState: { requestId: data.requestId, toolCallId: data.toolCallId, detail: data.detail || "waiting for free slot", free: typeof data.free === "number" ? data.free : 0, total: typeof data.total === "number" ? data.total : 0, modelAlias: data.modelAlias, pollIntervalSec: data.pollIntervalSec ?? 5, waitTimeoutSec: data.waitTimeoutSec ?? 300, statusMessage: undefined } });
});

wsClient.on("slot_wait_status", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  const cur = useChatStore.getState().slotWaitState;
  if (!cur || (data.requestId && cur.requestId !== data.requestId)) return;
  useChatStore.setState({ slotWaitState: { ...cur, statusMessage: data.message || cur.statusMessage } });
});

wsClient.on("slot_wait_ended", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId && data.sessionId !== currentId) return;
  const cur = useChatStore.getState().slotWaitState;
  if (!cur) return;
  if (data.requestId && cur.requestId !== data.requestId) return;
  useChatStore.setState({ slotWaitState: null });
});

wsClient.on("session_created", (data: any) => {
  const store = useChatStore.getState();
  if (store.sessionId === null && data.session) {
    const patch: any = { sessionId: data.session.id };
    if (data.session.workspaceRoot) {
      localStorage.setItem("VISUAL STUDIO HARNESS.workspaceRoot", data.session.workspaceRoot);
      patch.workspaceRoot = data.session.workspaceRoot;
    }
    useChatStore.setState(patch);
    useSessionViewStore.setState({ currentSessionId: data.session.id });
    import("../../stores/sessions").then(({ useSessionStore }) => { useSessionStore.getState().fetch(); });
  }
});

wsClient.on("session_state", (data: any) => {
  const currentId = useSessionViewStore.getState().currentSessionId;
  if (data.sessionId !== currentId) {
    console.debug(`[session_state] ignored: event session=${data.sessionId} != current=${currentId}`);
    return;
  }
  if (data.requestId != null && pendingSessionStateRequestId != null && data.requestId !== pendingSessionStateRequestId) {
    console.debug(`[session_state] ignored stale requestId=${data.requestId} pending=${pendingSessionStateRequestId}`);
    return;
  }
  const snapshotSeq = typeof data.upToSeq === "number" ? data.upToSeq : undefined;
  const curLast = useChatStore.getState().lastSeq;
  if (!awaitingSessionState && snapshotSeq != null && snapshotSeq < curLast) {
    console.debug(`[session_state] ignored stale upToSeq=${snapshotSeq} < lastSeq=${curLast}`);
    return;
  }
  try {
    if (data.history) {
      let msgs = data.history.filter((m: any) => m.role !== "system");
      const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
      const hasIncomplete = lastAssistant && lastAssistant.success !== true && lastAssistant.success !== false;
      if (hasIncomplete && lastAssistant) msgs = msgs.filter((m) => m !== lastAssistant);
      chatDebug("session_state", "apply", {
        awaiting: awaitingSessionState,
        bufferedDeltas: pendingDeltas.filter((e) => e.sessionId === data.sessionId).length,
        hasIncomplete,
        requestId: data.requestId,
      });
      msgs = msgs.map((m: any) => {
        if (m.parts && m.parts.length > 0) {
          const consolidated = consolidateTextParts(m.parts);
          if (consolidated.length === 0) return { ...m, parts: undefined };
          const fromParts = textContentFromParts(consolidated);
          return { ...m, parts: consolidated, content: fromParts || m.content || "" };
        }
        return m;
      });
      if (hasIncomplete && lastAssistant) {
        const { streamingParts, streamingContent, partSeq } = partsFromSnapshot(lastAssistant.parts || []);
        const upTo = snapshotSeq ?? partSeq;
        useChatStore.setState({ messages: msgs, sessionId: data.sessionId, streaming: true, streamingContent, streamingParts, lastSeq: upTo, _partSeq: upTo, _reasonIdx: 0 });
      } else {
        const upTo = snapshotSeq ?? maxSeqOf(msgs.flatMap((m: any) => m.parts || []));
        // If the store already has an active streaming turn (set by sendMessage),
        // preserve it — the session_state is historical context for a new session
        // and should not interrupt an already-started turn.
        const cur = useChatStore.getState();
        const preserveStreaming = cur.streaming && cur.sessionId === data.sessionId;
        useChatStore.setState({
          messages: msgs,
          sessionId: data.sessionId,
          streaming: preserveStreaming ? true : false,
          streamingContent: preserveStreaming ? cur.streamingContent : "",
          streamingParts: preserveStreaming ? cur.streamingParts : [],
          lastSeq: upTo,
          _partSeq: upTo,
          _reasonIdx: 0,
        });
      }
    }
  } finally {
    if (data.requestId == null || data.requestId === pendingSessionStateRequestId) {
      endAwaitSessionState();
      const appliedSeq = useChatStore.getState().lastSeq;
      replayPendingDeltas(data.sessionId, appliedSeq);
    }
  }
});

wsClient.on("session_updated", (data: any) => {
  if (data.session) {
    if (data.session.id === useChatStore.getState().sessionId) {
      useChatStore.getState().updateSessionMeta(data.session);
    }
    import("../../stores/sessions").then(({ useSessionStore }) => { useSessionStore.getState().upsertSession(data.session); });
  }
});

wsClient.on("session_stream_start", (data: any) => {
  import("../../stores/sessions").then(({ useSessionStore }) => {
    useSessionStore.getState().setStreaming(data.sessionId, true);
  });
});

wsClient.on("session_stream_end", (data: any) => {
  const viewed = useSessionViewStore.getState().currentSessionId === data.sessionId;
  import("../../stores/sessions").then(({ useSessionStore }) => {
    const store = useSessionStore.getState();
    store.setStreaming(data.sessionId, false);
    if (viewed) {
      store.clearDoneNotification(data.sessionId);
    } else if (data.success !== false) {
      store.setDoneNotification(data.sessionId, true);
    }
  });
});

let disconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;

wsClient.onDisconnect(() => {
  if (disconnectNoticeTimer) clearTimeout(disconnectNoticeTimer);
  disconnectNoticeTimer = setTimeout(() => {
    disconnectNoticeTimer = null;
    if (wsClient.connected) return;
    const { streaming, messages } = useChatStore.getState();
    if (streaming) {
      useChatStore.setState({
        messages: [...messages, { role: "assistant", content: "Connection lost. Backend may have stopped.", timestamp: new Date().toISOString() } as any],
        streaming: false,
        streamingContent: "",
        streamingParts: [],
        lastSeq: 0,
        _reasonIdx: 0,
      });
    }
  }, 8000);
});

wsClient.onReconnect(() => {
  if (disconnectNoticeTimer) { clearTimeout(disconnectNoticeTimer); disconnectNoticeTimer = null; }
  const sid = useChatStore.getState().sessionId;
  if (!sid) return;
  const requestId = beginReconnectSession();
  wsClient.send({ type: "request_session_state", sessionId: sid, requestId });
});
