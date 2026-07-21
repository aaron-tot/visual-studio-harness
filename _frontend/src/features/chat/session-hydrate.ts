import type { ToolCallStatus } from "../../../_shared/types";
import type { BufferedDelta } from "./types";

/** toolCallId -> permission tool name from last permission_request */
export const pendingPermToolNames = new Map<string, string>();

export let awaitingSessionState = false;
export let loadSessionEpoch = 0;
export let pendingSessionStateRequestId: number | null = null;
export let pendingDeltas: BufferedDelta[] = [];

export function beginAwaitSessionState(epoch: number, requestId: number) {
  awaitingSessionState = true;
  loadSessionEpoch = epoch;
  pendingSessionStateRequestId = requestId;
  pendingDeltas = [];
}

export function endAwaitSessionState() {
  awaitingSessionState = false;
  pendingSessionStateRequestId = null;
}

export function resetHydrateState() {
  awaitingSessionState = false;
  pendingSessionStateRequestId = null;
  pendingDeltas = [];
}

/** Safe increment of loadSessionEpoch (workaround for ESM import binding restrictions). */
export function incrementEpoch(): number {
  return ++loadSessionEpoch;
}

/** For reconnect: start a new epoch and begin awaiting. Returns the requestId. */
export function beginReconnectSession(): number {
  awaitingSessionState = true;
  const requestId = ++loadSessionEpoch;
  pendingSessionStateRequestId = requestId;
  pendingDeltas = [];
  return requestId;
}

export function bufferDelta(delta: BufferedDelta) {
  pendingDeltas.push(delta);
}

export function replayPendingDeltas(sessionId: string, afterSeq: number) {
  const { useChatStore } = require("./store");
  const buf = pendingDeltas.filter((e) => e.sessionId === sessionId);
  pendingDeltas = [];
  const s = useChatStore.getState();
  console.log("SESSION_HYDRATE_REPLAY", { deltasCount: buf.length, streaming: s.streaming });
  for (const e of buf) {
    if (e.kind === "error") {
      console.log("SESSION_HYDRATE_REPLAY_ERROR", { error: e.error, streaming: s.streaming });
      s.failStreaming(e.error, { modelName: e.modelName, providerName: e.providerName, durationMs: e.durationMs, turnId: e.turnId, agentName: e.agentName, rawError: e.rawError, errorIsCustom: e.errorIsCustom, category: e.category, status: e.status });
      continue;
    }
    if (e.kind === "done") {
      if (useChatStore.getState().streaming) useChatStore.getState().doneStreaming(e.modelName, e.providerName, e.durationMs, e.turnId, e.agentName);
      continue;
    }
    const seq = "seq" in e ? e.seq : undefined;
    if (seq != null && seq <= afterSeq) continue;
    if (e.kind === "token") useChatStore.getState().appendToken(e.content, e.seq);
    else if (e.kind === "reasoning") useChatStore.getState().appendReasoning(e.content, e.seq);
    else if (e.kind === "tool_start") useChatStore.getState().onToolStart({ toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, parentToolCallId: e.parentToolCallId, seq: e.seq });
    else if (e.kind === "tool_end") useChatStore.getState().onToolEnd({ toolCallId: e.toolCallId, status: e.status, result: e.result, error: e.error, seq: e.seq });
    else if (e.kind === "tool_update") useChatStore.getState().onToolUpdate({ toolCallId: e.toolCallId, status: e.status, partial: e.partial, seq: e.seq });
  }
}
